import LifetimeFixtures
import Testing

@Suite(.serialized)
struct LifetimeTests {
    @Test func nativeRootKeepsCallbackAlive() { #expect(lifetime_native_root()) }
    @Test func javaScriptOwnerKeepsNativeReferencesAlive() { #expect(lifetime_js_owner()) }
    @Test func unreachableNativeCycleIsCollected() { #expect(lifetime_native_cycle()) }
    @Test func replacingAnEdgeReleasesOldValueAndPreservesIdentity() { #expect(lifetime_replace_edge()) }
    @Test func olderWrapperKeepsIdentityAfterNewerAliasDies() { #expect(lifetime_older_alias()) }
    @Test func identityMissDoesNotScaleWithUnrelatedWrappers() { #expect(lifetime_identity_miss_scaling()) }
    @Test func expiredFacadeFallsBackToOlderAlias() { #expect(lifetime_expired_facade_alias()) }
    @Test func removingMiddleAliasPreservesItsNeighbors() { #expect(lifetime_middle_alias()) }
    @Test func survivingAliasKeepsValueAlive() { #expect(lifetime_aliases()) }
    @Test func nativeTurnKeepsForeignChildAfterJavaScriptOwnerIsRemoved() { #expect(lifetime_native_turn_root()) }
    @Test func repeatedExplicitCycleCleanupDoesNotGrowCaches() { #expect(lifetime_churn()) }
    @Test func gcThreadFinalizerDefersNativeRelease() { #expect(lifetime_deferred_finalizer()) }
    @Test func wrapperFinalizationAfterDisposalIsSafe() { #expect(lifetime_dispose_with_js_owner()) }
    @Test func temporaryStringSurvivesOnlyUntilScopeEnds() { #expect(lifetime_temporary_string()) }
    @Test func temporaryArrayFacadeSurvivesCollection() { #expect(lifetime_temporary_facade()) }
    @Test func addingForeignChildPreservesWrapperIdentity() { #expect(lifetime_first_foreign_edge()) }
    @Test func opaqueHandlesUseOnlyBoundaryLifetimeOperations() { #expect(lifetime_opaque_runtime()) }
    @Test func sharedNativeChildSurvivesEitherWrapper() { #expect(lifetime_contraction_two_anchors()) }
    @Test func nativeCyclesReleaseForeignChildren() { #expect(lifetime_contraction_foreign_outgoing_cycle()) }
    @Test func removingDuplicateEdgesReleasesOnlyTheLastReachablePath() { #expect(lifetime_persistent_duplicate_removal()) }
    @Test func growingNativeObjectKeepsAndReleasesForeignValues() { #expect(lifetime_persistent_expansion()) }
    @Test func queuedFinalizerDoesNotRetireTheReplacementWrapper() { #expect(lifetime_persistent_replacement_finalizer()) }
}
