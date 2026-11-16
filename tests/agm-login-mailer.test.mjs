import assert from "node:assert/strict";
import { test } from "node:test";

import { createAgmLoginMailer } from "../server/loginMailer.mjs";

const config = {
  baseUrl: "https://agm-api.example.test",
  email: "trader@example.test",
  password: "test-service-credential",
};

test("uses one scoped token and sends only the verified address and code", async () => {
  const requests = [];
  const mailer = createAgmLoginMailer(config, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return url.endsWith("/token")
        ? Response.json({ access_token: "fixture-token", expires_in: 3600 })
        : Response.json({ accepted: true });
    },
  });

  await Promise.all([
    mailer("first@example.test", "00123456"),
    mailer("second@example.test", "12345678"),
  ]);
  assert.equal(requests.length, 3);
  const [login, ...sends] = requests;
  assert.equal(login.url, config.baseUrl + "/token");
  assert.deepEqual(login.body, {
    email: config.email,
    password: config.password,
  });
  assert.equal(login.options.headers.Authorization, undefined);
  assert.equal(login.options.redirect, "error");
  for (const send of sends) {
    assert.equal(send.url, config.baseUrl + "/trader/send_login_code");
    assert.equal(send.options.headers.Authorization, "Bearer fixture-token");
    assert.equal(send.options.redirect, "error");
  }
  assert.deepEqual(
    sends.map(({ body }) => body),
    [
      { email: "first@example.test", code: "00123456" },
      { email: "second@example.test", code: "12345678" },
    ],
  );
});

test("a rejected send is attempted once and the next code gets a fresh token", async () => {
  let logins = 0;
  let sends = 0;
  const mailer = createAgmLoginMailer(config, {
    fetchImpl: async (url) => {
      if (url.endsWith("/token")) {
        return Response.json({
          access_token: "test-token-" + ++logins,
          expires_in: 3600,
        });
      }
      return ++sends === 1
        ? Response.json({ error: "private upstream details" }, { status: 401 })
        : Response.json({ accepted: true });
    },
  });
  await assert.rejects(mailer("customer@example.test", "12345678"), {
    message: "AGM login email was not accepted",
  });
  assert.equal(sends, 1);
  await mailer("customer@example.test", "12345679");
  assert.equal(logins, 2);
  assert.equal(sends, 2);
});
