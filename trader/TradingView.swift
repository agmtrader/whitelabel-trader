import SwiftUI
import Charts

struct TradingView: View {
    
    // Hardcoded balance data for the chart
    @State private var balanceHistory: [BalancePoint] = [
        BalancePoint(date: "10:00", balance: 10000),
        BalancePoint(date: "11:00", balance: 10200),
        BalancePoint(date: "12:00", balance: 10150),
        BalancePoint(date: "13:00", balance: 10400),
        BalancePoint(date: "14:00", balance: 10350),
        BalancePoint(date: "15:00", balance: 10500),
        BalancePoint(date: "16:00", balance: 10650)
    ]
    
    // Hardcoded watchlist
    @State private var watchlist: [WatchlistItem] = [
        WatchlistItem(symbol: "AAPL", name: "Apple Inc.", price: 178.45, change: 2.34, changePercent: 1.33),
        WatchlistItem(symbol: "GOOGL", name: "Alphabet Inc.", price: 142.89, change: -1.23, changePercent: -0.85),
        WatchlistItem(symbol: "MSFT", name: "Microsoft Corp.", price: 416.78, change: 5.67, changePercent: 1.38),
        WatchlistItem(symbol: "TSLA", name: "Tesla Inc.", price: 251.34, change: -3.45, changePercent: -1.35),
        WatchlistItem(symbol: "AMZN", name: "Amazon.com Inc.", price: 178.92, change: 0.78, changePercent: 0.44),
        WatchlistItem(symbol: "NVDA", name: "NVIDIA Corp.", price: 485.23, change: 12.45, changePercent: 2.63),
        WatchlistItem(symbol: "META", name: "Meta Platforms", price: 523.67, change: -2.11, changePercent: -0.40)
    ]
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    
                    // Balance Chart Section
                    VStack(alignment: .leading, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Balance de Cuenta")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            
                            Text("$\(balanceHistory.last?.balance ?? 0, specifier: "%.2f")")
                                .font(.system(size: 36, weight: .bold))
                            
                            HStack(spacing: 4) {
                                Image(systemName: "arrow.up.right")
                                    .font(.caption)
                                Text("+$\(balanceHistory.last!.balance - balanceHistory.first!.balance, specifier: "%.2f") (+\((((balanceHistory.last!.balance - balanceHistory.first!.balance) / balanceHistory.first!.balance) * 100), specifier: "%.2f")%)")
                                    .font(.subheadline)
                            }
                            .foregroundStyle(.green)
                        }
                        .padding(.horizontal)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical)
                    .background(Color(.systemBackground))
                    
                    // Trading Buttons
                    HStack(spacing: 16) {
                        // Buy Button
                        Button(action: {
                            print("Buy pressed")
                        }) {
                            HStack {
                                Image(systemName: "arrow.up.circle.fill")
                                    .font(.title3)
                                Text("Comprar")
                                    .font(.headline)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(.green)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        
                        // Sell Button
                        Button(action: {
                            print("Sell pressed")
                        }) {
                            HStack {
                                Image(systemName: "arrow.down.circle.fill")
                                    .font(.title3)
                                Text("Vender")
                                    .font(.headline)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(.red)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                    }
                    .padding(.horizontal)
                    
                    // Watchlist Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Lista de Seguimiento")
                            .font(.title3)
                            .fontWeight(.semibold)
                            .padding(.horizontal)
                        
                        VStack(spacing: 0) {
                            ForEach(watchlist) { item in
                                WatchlistRow(item: item)
                                
                                if item.id != watchlist.last?.id {
                                    Divider()
                                        .padding(.leading, 16)
                                }
                            }
                        }
                    }
                    .padding(.bottom)
                }
            }
        }
    }
}

// MARK: - Watchlist Row Component
struct WatchlistRow: View {
    let item: WatchlistItem
    
    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.symbol)
                    .font(.headline)
                Text(item.name)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
            
            VStack(alignment: .trailing, spacing: 4) {
                Text("$\(item.price, specifier: "%.2f")")
                    .font(.headline)
                
                HStack(spacing: 4) {
                    Image(systemName: item.change >= 0 ? "arrow.up.right" : "arrow.down.right")
                        .font(.caption2)
                    Text("\(item.change >= 0 ? "+" : "")\(item.changePercent, specifier: "%.2f")%")
                        .font(.caption)
                }
                .foregroundStyle(item.change >= 0 ? .green : .red)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

// MARK: - Data Models
struct BalancePoint: Identifiable {
    let id = UUID()
    let date: String
    let balance: Double
}

struct WatchlistItem: Identifiable {
    let id = UUID()
    let symbol: String
    let name: String
    let price: Double
    let change: Double
    let changePercent: Double
}
