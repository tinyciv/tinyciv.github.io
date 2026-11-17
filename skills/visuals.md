Avoid editing this file without the user's explicit approval.

Make sure to follow these rules:
- Consider carefully the existing resolution and style of game assets before producing new ones. Common failure modes include 1) using a very detailed image or asset which then downscales poorly, and 2) imbalance between visual elements of an image, e.g. a house roof which is too large.
- Look at all the assets in public/assets.
- When producing assets, you should produce a diverse set with variation across the axes of 1) detail, 2) resolution, and 3) realism-to-cartoon. Present these as a simple HTML file with labels for each one, e.g. 1A, 2C, etc. For the user to review. do not insert them into the game directly without consultation first.
- For a given task, create a new folder name in scratch like `2026-10-26-create-temple` and put all files in that folder.
- Use the PixelLab API for all animation and character generation; avoid creating them by hand. When using this API, be sure to set the camera setting to high top-down and make sure it is not isomorphiv. ALWAYS use existing assets as grounding context for the PixelLab API.
- The resolution of new ingame objects should by 16x16 for each grid cell. If a building is 2x2, it can be 32x32 resolution and so on.
- For objects which need 8 directions, create the one-direction object first at 16x16 then create the rotations from that result; otherwise the API requires 24 px size.
- ALWAYS ground PixelLab-generated assets by using existing assets; consider whether tilemap, objects, sprite, or other type is best suited to act as a reference. Buildings and existing tiles are usually a good choice for grounding creation of new fixed objects.
