// swift-tools-version: 6.0
import Foundation
import PackageDescription

let runtimeHeaders = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("../runtime/src").standardized.path
let runtimeLibrary = ProcessInfo.processInfo.environment["SCRIPTC_RUNTIME_LIBRARY"]
let package = Package(
    name: "ScriptCJavaScriptCore",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "ScriptCJavaScriptCore", targets: ["ScriptCJavaScriptCore"])],
    targets: [
        .target(
            name: "ScriptCJavaScriptCore",
            cSettings: [.define("SCR_LIB"), .unsafeFlags(["-I", runtimeHeaders, "-fobjc-arc", "-fno-modules"])],
            linkerSettings: [.linkedFramework("Foundation"), .linkedFramework("JavaScriptCore")]
        ),
        .target(
            name: "LifetimeFixtures",
            dependencies: ["ScriptCJavaScriptCore"],
            path: "Tests/LifetimeFixtures",
            cSettings: [.define("SCR_LIB"), .unsafeFlags(["-I", runtimeHeaders, "-fobjc-arc", "-fno-modules"])],
            linkerSettings: runtimeLibrary.map { [.unsafeFlags([$0])] } ?? []
        ),
        .testTarget(name: "LifetimeTests", dependencies: ["LifetimeFixtures"]),
    ]
)
