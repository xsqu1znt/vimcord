# TODO

- [ ] Explore stateless pagination in a future update.
    - Define reusable paginators beside commands and attach them to the command module so the existing loader registers them at startup. Avoid a central list of `client.components.register(...)` calls.
    - Keep page, chapter, participant, and expiry context in component IDs where it fits Discord's 100-character limit; rebuild content from small inputs or existing persistent data. Start with Bloom's handbook, then consider help.
    - Verify the tradeoff between retained memory and rebuilding or fetching pages. Wishlist would change from a snapshot to live data; inventory should retain its batch caching and exact displayed-ID exports unless a migration preserves those benefits.
    - Decide how expiry should appear to users. Rejecting expired clicks can be stateless; automatically disabling untouched messages still needs a timer or scheduled cleanup.

- [ ] Explore reusable stateless component handlers for BetterCollector in a future update.
    - Use the same define → attach → use flow as pagination, with handlers registered at startup through their owning command module. API names such as `BetterCollector.define(...)` and `components: [...]` remain proposals.
    - Start with Bloom's agency invitation acceptance: encode the agency ID, preserve participant restrictions, use the existing transactional join service, and replace the menu on success instead of retaining callback state.
    - Migrate incrementally. Moving a button handler does not make its surrounding paginator or awaited modal stateless; modal submissions need their own handlers for restart continuity.
    - Keep collectors that require captured session state, claim coordination, history, or end callbacks stateful unless persistent state is justified. Bloom's drops are not an initial migration candidate.
