//
//  APIService.swift
//  trader
//
//  Created by Andrés on 2/10/2025.
//

import Foundation

enum APIError: Error, LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int)
    case decodingError(Error)
    case networkError(Error)
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode):
            return "HTTP error: \(statusCode)"
        case .decodingError(let error):
            return "Decoding error: \(error.localizedDescription)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        }
    }
}

class APIService {
    static let shared = APIService()
    
    private let baseURL = "http://10.4.178.250:5000"
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        self.session = URLSession(configuration: config)
    }

    // MARK: - Token Handling
    private func fetchToken() async throws -> String {
        print("Fetching bearer token…")
        guard let url = URL(string: "\(baseURL)/token") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: Any] = ["token": "all"]
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(statusCode: httpResponse.statusCode)
        }

        do {
            let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
            print("Token response: \(decoded)")
            return decoded.accessToken
        } catch {
            print("Decoding token failed: \(error.localizedDescription)")
            throw APIError.decodingError(error)
        }
    }
    
    // MARK: - Request Helpers

    /// Performs the on-wire request and returns raw `Data` if the request succeeds.
    private func performRequest(endpoint: String,
                                method: String,
                                body: [String: Any]?) async throws -> Data {
        guard let url = URL(string: "\(baseURL)\(endpoint)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let body = body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        // Inject fresh bearer token
        let token = try await fetchToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                throw APIError.httpError(statusCode: httpResponse.statusCode)
            }

            return data
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }

    // MARK: - Public Request API

    /// Sends a request **without** caring about the response body. Throws if the request fails.
    @discardableResult
    func request(endpoint: String,
                 method: String = "POST",
                 body: [String: Any]? = nil) async throws -> Data {
        try await performRequest(endpoint: endpoint, method: method, body: body)
    }

    /// Sends a request and decodes the response body into the supplied `Decodable` type.
    func request<T: Decodable>(endpoint: String,
                               method: String = "POST",
                               body: [String: Any]? = nil,
                               responseType: T.Type) async throws -> T {
        let data = try await performRequest(endpoint: endpoint, method: method, body: body)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }
    
    // MARK: - Utility – Public IP
    func fetchPublicIP() async throws -> String {
        print("Fetching public IP…")
        guard let url = URL(string: "https://api.ipify.org?format=json") else { throw APIError.invalidURL }
        let (data, _) = try await session.data(from: url)
        let decoded = try JSONDecoder().decode(IPResponse.self, from: data)
        print("Device IP: \(decoded.ip)")
        return decoded.ip
    }
}

// MARK: - Response Models
private struct IPResponse: Codable {
    let ip: String
}

// MARK: - Accounts Info Models

struct AccountsResponse: Codable {
    let accounts: [String]
    let aliases: [String: String]
    let allowFeatures: AllowFeatures
    let selectedAccount: String
    
    struct AllowFeatures: Codable {
        let allowedAssetTypes: String
    }
    
    /// Convenience property to get alias for the selected account
    var selectedAlias: String? {
        return aliases[selectedAccount]
    }
}

// MARK: - Token Response Model

struct TokenResponse: Codable {
    let accessToken: String
    
    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
    }
}

