// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ScriptCJavaScriptCore",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "ScriptCJavaScriptCore", targets: ["ScriptCJavaScriptCore"])],
    targets: [
        .target(
            name: "ScriptCJavaScriptCore",
            path: "packages/jsc/Sources/ScriptCJavaScriptCore",
            cSettings: [.define("SCR_LIB"), .headerSearchPath("../../../runtime/src")],
            linkerSettings: [.linkedFramework("Foundation"), .linkedFramework("JavaScriptCore")]
        ),
    ]
)
