import SwiftUI

struct AccountView: View {
    @ObservedObject private var account = AccountModel.shared
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                List {
                    Button("Cerrar sesión") {
                        Task {
                            await account.logout()
                        }
                    }
                }
            }
            .navigationTitle("Cuenta")
            .navigationSubtitle(Text(("\(String(describing: account.accountsInfo?.selectedAlias ?? account.accountsInfo?.selectedAccount ?? ""))")))
        }
    }
}