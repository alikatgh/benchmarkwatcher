import SwiftUI
import ResearchCore

@main
struct BenchmarkWatcherApp: App {
    @StateObject private var store = ResearchStore()
    var body: some Scene {
        #if os(macOS)
        WindowGroup {
            MacWorkspace()
                .frame(minWidth: 940, minHeight: 620)
        }.environmentObject(store)
        .defaultSize(width: 1180, height: 780)
        .commands {
            CommandGroup(after: .help) {
                Link("BenchmarkWatcher Support", destination: URL(string: "https://benchmarkwatcher.online/support")!)
                Link("Privacy", destination: URL(string: "https://benchmarkwatcher.online/privacy")!)
            }
        }
        WindowGroup("Compare companies", id: "compare", for: String.self) { $cik in
            MacComparison(initialCIK: cik).environmentObject(store).frame(minWidth: 960, minHeight: 580)
        }.defaultSize(width: 1140, height: 720)
        #else
        WindowGroup { PhoneRoot().environmentObject(store) }
        #endif
    }
}
