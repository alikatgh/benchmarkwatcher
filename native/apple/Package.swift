// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BenchmarkWatcherCore",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "ResearchCore", targets: ["ResearchCore"])],
    targets: [
        .target(name: "ResearchCore"),
        .testTarget(name: "ResearchCoreTests", dependencies: ["ResearchCore"],
                    resources: [.copy("Fixtures/report.json")])
    ]
)
