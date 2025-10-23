//
//  ContentView.swift
//  trader
//
//  Created by Andrés on 2/10/2025.
//

import SwiftUI

struct ContentView: View {

    @ObservedObject private var account = AccountModel.shared

    @State private var isLoading = false
    @State private var credential = ""
    
    var body: some View {
        VStack(spacing: 20) {
            
            if !account.isLoggedIn && !isLoading {
                TextField("Usuario", text: $credential)
                    .textFieldStyle(.plain)
                    .autocapitalization(.none)
                    .padding(.all, 5)
                    .background(Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                    .frame(width: 250)
                
                Button(action: {
                    Task {
                        isLoading = true
                        await account.login(credential: credential)
                        isLoading = false
                    }
                }) {
                    HStack {
                        if isLoading {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .foregroundStyle(.white)
                        } else {
                            Text("Iniciar sesion")
                        }
                    }
                    .padding()
                }
                .foregroundStyle(.white)
                .disabled(credential.isEmpty)
                .background(Color(.blue))
                .clipShape(RoundedRectangle(cornerRadius: 5))
                .frame(width: 150)
                
            } else if account.isLoggedIn && !isLoading {
                TabView {
                    Tab("Ejecutar", systemImage: "chart.line.uptrend.xyaxis") {
                        TradingView()
                    }
                    Tab("Cuenta", systemImage: "person.fill") {
                        AccountView()
                    }

                }

            }
        }
    }
}

#Preview {
    ContentView()
}
