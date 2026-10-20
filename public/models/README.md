# Player character

`community-character.glb` is the user-provided Community 3D Game Asset.
The original embedded 4096px textures were resized to 1024px for browser loading;
mesh geometry and PBR materials are preserved. The model is approximately 1.1 MB.

The file has no skeleton or animation clips. The client uses subtle whole-model
movement sway, rotates the asset to face local +Z, scales it to 1.8 units tall,
and grounds its feet. Each runner has an independent clone with shared geometry
and textures. Team beacons and controller rings identify the two teams. The local
runner's model is hidden in first person. Loading failure uses the original avatar.
