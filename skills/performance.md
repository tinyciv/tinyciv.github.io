# Performance

Apply these instructions when developing or changing game code.

1. Keep routine frame work within a 33 ms budget.
2. Spread expensive work across frames using bounded queues.
3. Preserve deterministic ordering and fairness in queued work.
4. Preserve elapsed gameplay time when deferring scheduled work.
5. Prioritize input, movement, collision, and combat responsiveness.
6. Use spatial indexes for nearby entities and occupied tiles.
7. Maintain entity-role indexes as entities change.
8. Publish explicit revisions for terrain, structures, and ownership changes.
9. Scope cache dependencies to the data each calculation actually uses.
10. Keep cached arrays immutable and ownership boundaries explicit.
11. Share navigation fields across consumers and refresh them incrementally.
12. Reuse search buffers, heaps, temporary worlds, and rendering resources.
13. Generate nearby candidates lazily and stop when sufficient.
14. Keep placement previews lightweight and free of gameplay mutations.
15. Apply construction rules, resource charges, and farm relocation per purchased tile.
16. Coalesce bookkeeping and process cleanup in separate frame phases.
17. Let queued player commands and cleanup finish while paused.
18. Retain sprites and textures; redraw only affected terrain and geometry.
19. Serialize autosaves incrementally and preserve write ordering.
20. Use Pixel Operator for all in-game text.
