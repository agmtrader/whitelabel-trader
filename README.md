# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

## Local IBKR trading server

This app no longer needs `agm-api` for the IBKR trading screens. It now expects a small local server inside this repo.

1. Create a local env file:

   ```bash
   cp .env.example .env.local
   ```

2. Set the required values in `.env.local`:

   - `EXPO_PUBLIC_TRADER_API_BASE_URL`
   - `TRADER_API_PORT`
   - `GCLOUD_PROJECT` if you need something other than `agm-datalake`

   By default the server now fetches `IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY` from Google Secret Manager using the official Node client and your local Google credentials / ADC context.
   You can still override it with `IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY` or `IBKR_ACCOUNT_MANAGEMENT_PRIVATE_KEY_FILE` if needed.

3. Start the trading server:

   ```bash
   npm run server
   ```

4. Start Expo in a separate terminal:

   ```bash
   npm run web
   ```

   Or start both together:

   ```bash
   npm run dev
   ```

If you run the app on a physical device, `EXPO_PUBLIC_TRADER_API_BASE_URL` must be set to your machine's LAN IP, not `localhost`.

The server will fail fast if your local Google credentials cannot access Secret Manager.

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
