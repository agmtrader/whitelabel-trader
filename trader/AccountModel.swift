import Foundation
import SwiftUI
import Combine

@MainActor
final class AccountModel: ObservableObject {
    
    static let shared = AccountModel()
    private init() {}
    
    // MARK: - Published State
    @Published var isLoggedIn = false
    @Published var accountBalance: Double?
    @Published var accountsInfo: AccountsResponse?
    
    // MARK: - Public API
    func login(credential: String) async {
        guard !isLoggedIn else { return }
        
        do {
            // Create SSO session
            let ipAddress = try await APIService.shared.fetchPublicIP()
            let body: [String: Any] = [
                "credential": credential,
                "ip": ipAddress
            ]
            _ = try await APIService.shared.request(endpoint: "/accounts/ibkr/sso/create", method: "POST", body: body)

            // Initialize brokerage session
            _ = try await APIService.shared.request(endpoint: "/accounts/ibkr/sso/initialize", method: "POST")

            // Fetch accounts info
            isLoggedIn = true
            await fetchAccounts()
        } catch {
            print("Failed to login: \(error.localizedDescription)")
            isLoggedIn = false
        }
        
    }
    
    func logout() async {
        guard !isLoggedIn else { return }
        
        do {
            _ = try await APIService.shared.request(endpoint: "/accounts/ibkr/sso/logout", method: "POST")
            isLoggedIn = false
        } catch {
            print("Failed to logout: \(error.localizedDescription)")
        }
        
    }
    
    private func fetchAccounts() async {
        do {
            let response = try await APIService.shared.request(endpoint: "/accounts/ibkr/sso/accounts", method: "GET", responseType: AccountsResponse.self)
            accountsInfo = response
        } catch {
            print("Failed to fetch accounts info: \(error.localizedDescription)")
        }
    }
}
