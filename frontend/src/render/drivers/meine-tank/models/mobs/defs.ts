// defs.ts — geometry of the wave-1 fauna (bee, parrot, chicken, bat, allay).
// Box sizes/UV follow the vanilla entity textures (Faithful is 2x, UV fractions match).
//
// Relative path: ./frontend/src/render/drivers/meine-tank/models/mobs/defs.ts
import type { MobGeometry } from "./geometry.ts";

export type MobSpecies =
  "bee" | "parrot" | "chicken" | "bat" | "allay" | "rabbit" | "fox" | "dragon" | "cow" | "pig" | "frog" | "axolotl";

export const MOB_GEOMETRY: Record<MobSpecies, MobGeometry> = {
  bee: {
    texWidth: 64,
    texHeight: 64,
    bones: [
      {
        name: "body",
        pivot: [0.5, 5, 0],
        cubes: [
          { origin: [-3, 2, -5], size: [7, 7, 10], uv: [0, 0] },
          { origin: [2, 7, -8], size: [1, 2, 3], uv: [2, 0] },
          { origin: [-2, 7, -8], size: [1, 2, 3], uv: [2, 3] },
        ],
      },
      {
        name: "stinger",
        parent: "body",
        pivot: [0.5, 6, 1],
        cubes: [{ origin: [0.5, 5, 5], size: [0, 1, 2], uv: [26, 7] }],
      },
      {
        name: "rightwing_bone",
        parent: "body",
        pivot: [-1, 9, -3],
        rotation: [15, -15, 0],
        cubes: [{ origin: [-10, 9, -3], size: [9, 0, 6], uv: [0, 18] }],
      },
      {
        name: "leftwing_bone",
        parent: "body",
        pivot: [2, 9, -3],
        rotation: [15, 15, 0],
        cubes: [{ origin: [2, 9, -3], size: [9, 0, 6], uv: [9, 24] }],
      },
      {
        name: "leg_front",
        parent: "body",
        pivot: [2, 2, -2],
        cubes: [{ origin: [-3, 0, -2], size: [7, 2, 0], uv: [26, 1] }],
      },
      {
        name: "leg_mid",
        parent: "body",
        pivot: [2, 2, 0],
        cubes: [{ origin: [-3, 0, 0], size: [7, 2, 0], uv: [26, 3] }],
      },
      {
        name: "leg_back",
        parent: "body",
        pivot: [2, 2, 2],
        cubes: [{ origin: [-3, 0, 2], size: [7, 2, 0], uv: [26, 5] }],
      },
    ],
  },

  parrot: {
    texWidth: 32,
    texHeight: 32,
    bones: [
      { name: "body", pivot: [0, 7.5, -3], cubes: [{ origin: [-1.5, 1.5, -4.5], size: [3, 6, 3], uv: [2, 8] }] },
      {
        name: "head",
        parent: "body",
        pivot: [0, 8.3, -2.8],
        cubes: [
          { origin: [-1, 6.8, -3.8], size: [2, 3, 2], uv: [2, 2] },
          { origin: [-1, 9.8, -5.8], size: [2, 1, 4], uv: [10, 0] },
          { origin: [-0.5, 7.8, -4.7], size: [1, 2, 1], uv: [11, 7] },
          { origin: [-0.5, 8.1, -5.7], size: [1, 1.7, 1], uv: [16, 7] },
          { origin: [0, 9.1, -4.9], size: [0, 5, 4], uv: [2, 18] },
        ],
      },
      {
        name: "tail",
        parent: "body",
        pivot: [0, 2.9, 1.2],
        cubes: [{ origin: [-1.5, -0.1, 0.2], size: [3, 4, 1], uv: [22, 1] }],
      },
      {
        name: "wing0",
        parent: "body",
        pivot: [1.5, 7.1, -2.8],
        cubes: [{ origin: [1, 2.1, -4.3], size: [1, 5, 3], uv: [19, 8] }],
      },
      {
        name: "wing1",
        parent: "body",
        pivot: [-1.5, 7.1, -2.8],
        cubes: [{ origin: [-2, 2.1, -4.3], size: [1, 5, 3], uv: [19, 8] }],
      },
      {
        name: "leg0",
        parent: "body",
        pivot: [1.5, 1, -0.5],
        cubes: [{ origin: [0.5, -0.5, -1.5], size: [1, 2, 1], uv: [14, 18] }],
      },
      {
        name: "leg1",
        parent: "body",
        pivot: [-0.5, 1, -0.5],
        cubes: [{ origin: [-1.5, -0.5, -1.5], size: [1, 2, 1], uv: [14, 18] }],
      },
    ],
  },

  chicken: {
    texWidth: 64,
    texHeight: 32,
    bones: [
      { name: "body", pivot: [0, 8, 0], cubes: [{ origin: [-3, 4, -3], size: [6, 8, 6], uv: [0, 9] }] },
      {
        name: "head",
        parent: "body",
        pivot: [0, 9, -4],
        cubes: [
          { origin: [-2, 9, -6], size: [4, 6, 3], uv: [0, 0] },
          { origin: [-1, 9, -7], size: [2, 2, 2], uv: [14, 4] },
          { origin: [-2, 11, -8], size: [4, 2, 2], uv: [14, 0] },
        ],
      },
      { name: "leg0", pivot: [-2, 5, 1], cubes: [{ origin: [-3, 0, -2], size: [3, 5, 3], uv: [26, 0] }] },
      { name: "leg1", pivot: [1, 5, 1], cubes: [{ origin: [0, 0, -2], size: [3, 5, 3], uv: [26, 0] }] },
      {
        name: "wing0",
        parent: "body",
        pivot: [-3, 11, 0],
        cubes: [{ origin: [-4, 7, -3], size: [1, 4, 6], uv: [24, 13] }],
      },
      {
        name: "wing1",
        parent: "body",
        pivot: [3, 11, 0],
        cubes: [{ origin: [3, 7, -3], size: [1, 4, 6], uv: [24, 13] }],
      },
    ],
  },

  bat: {
    texWidth: 64,
    texHeight: 64,
    bones: [
      {
        name: "head",
        pivot: [0, 24, 0],
        cubes: [
          { origin: [-3, 21, -3], size: [6, 6, 6], uv: [0, 0] },
          { origin: [-4, 26, -2], size: [3, 4, 1], uv: [24, 0] },
          { origin: [1, 26, -2], size: [3, 4, 1], uv: [24, 0], mirror: true },
        ],
      },
      {
        name: "body",
        parent: "head",
        pivot: [0, 24, 0],
        cubes: [
          { origin: [-3, 8, -3], size: [6, 12, 6], uv: [0, 16] },
          { origin: [-5, -8, 0], size: [10, 16, 1], uv: [0, 34] },
        ],
      },
      {
        name: "rightWing",
        parent: "body",
        pivot: [0, 24, 0],
        cubes: [{ origin: [-12, 7, 1.5], size: [10, 16, 1], uv: [42, 0] }],
      },
      {
        name: "rightWingTip",
        parent: "rightWing",
        pivot: [-12, 23, 1.5],
        cubes: [{ origin: [-20, 10, 1.5], size: [8, 12, 1], uv: [24, 16] }],
      },
      {
        name: "leftWing",
        parent: "body",
        pivot: [0, 24, 0],
        cubes: [{ origin: [2, 7, 1.5], size: [10, 16, 1], uv: [42, 0], mirror: true }],
      },
      {
        name: "leftWingTip",
        parent: "leftWing",
        pivot: [12, 23, 1.5],
        cubes: [{ origin: [12, 10, 1.5], size: [8, 12, 1], uv: [24, 16], mirror: true }],
      },
    ],
  },

  allay: {
    texWidth: 32,
    texHeight: 32,
    bones: [
      { name: "root", pivot: [0, 0, 0] },
      {
        name: "body",
        parent: "root",
        pivot: [0, 5, 0],
        cubes: [
          { origin: [-1.5, 1, -1], size: [3, 4, 2], uv: [0, 10] },
          { origin: [-1.5, 0, -1], size: [3, 5, 2], uv: [0, 16] },
        ],
      },
      {
        name: "head",
        parent: "body",
        pivot: [0, 5, 0],
        cubes: [{ origin: [-2.5, 5.01, -2.5], size: [5, 5, 5], uv: [0, 0] }],
      },
      {
        name: "right_arm",
        parent: "body",
        pivot: [-1.75, 4.5, 0],
        cubes: [{ origin: [-2.5, 1, -1], size: [1, 4, 2], uv: [23, 0] }],
      },
      {
        name: "left_arm",
        parent: "body",
        pivot: [1.75, 4.5, 0],
        cubes: [{ origin: [1.5, 1, -1], size: [1, 4, 2], uv: [23, 6] }],
      },
      {
        name: "left_wing",
        parent: "body",
        pivot: [0.5, 4, 1],
        cubes: [{ origin: [0.5, -1, 1], size: [0, 5, 8], uv: [16, 14] }],
      },
      {
        name: "right_wing",
        parent: "body",
        pivot: [-0.5, 4, 1],
        cubes: [{ origin: [-0.5, -1, 1], size: [0, 5, 8], uv: [16, 14] }],
      },
    ],
  },

  rabbit: {
    texWidth: 64,
    texHeight: 32,
    bones: [
      { name: "body", pivot: [0, 5, 8], cubes: [{ origin: [-3, 2, -2], size: [6, 5, 10], uv: [0, 0] }] },
      {
        name: "haunchLeft",
        parent: "body",
        pivot: [3, 6.5, 3.7],
        cubes: [{ origin: [2, 2.5, 3.7], size: [2, 4, 5], uv: [16, 15] }],
      },
      {
        name: "haunchRight",
        parent: "body",
        pivot: [-3, 6.5, 3.7],
        cubes: [{ origin: [-4, 2.5, 3.7], size: [2, 4, 5], uv: [30, 15] }],
      },
      {
        name: "rearFootLeft",
        parent: "body",
        pivot: [3, 6.5, 3.7],
        cubes: [{ origin: [2, 0, 0], size: [2, 1, 7], uv: [8, 24] }],
      },
      {
        name: "rearFootRight",
        parent: "body",
        pivot: [-3, 6.5, 3.7],
        cubes: [{ origin: [-4, 0, 0], size: [2, 1, 7], uv: [26, 24] }],
      },
      {
        name: "frontLegLeft",
        parent: "body",
        pivot: [3, 7, -1],
        cubes: [{ origin: [2, 0, -2], size: [2, 7, 2], uv: [8, 15] }],
      },
      {
        name: "frontLegRight",
        parent: "body",
        pivot: [-3, 7, -1],
        cubes: [{ origin: [-4, 0, -2], size: [2, 7, 2], uv: [0, 15] }],
      },
      {
        name: "head",
        parent: "body",
        pivot: [0, 8, -1],
        cubes: [
          { origin: [-2.5, 8, -6], size: [5, 4, 5], uv: [32, 0] },
          { origin: [-2.5, 12, -2], size: [2, 5, 1], uv: [58, 0] },
          { origin: [0.5, 12, -2], size: [2, 5, 1], uv: [52, 0] },
        ],
      },
      {
        name: "nose",
        parent: "body",
        pivot: [0, 8, -1],
        cubes: [{ origin: [-0.5, 9.5, -6.5], size: [1, 1, 1], uv: [32, 9] }],
      },
      {
        name: "tail",
        parent: "body",
        pivot: [0, 4, 7],
        cubes: [{ origin: [-1.5, 2.5, 7], size: [3, 3, 2], uv: [52, 6] }],
      },
    ],
  },

  fox: {
    texWidth: 64,
    texHeight: 32,
    bones: [
      { name: "root", pivot: [0, 0, 0] },
      {
        name: "body",
        parent: "root",
        pivot: [0, 8, 0],
        cubes: [{ origin: [-3, 0, -3], size: [6, 11, 6], uv: [30, 15] }],
      },
      {
        name: "head",
        parent: "body",
        pivot: [0, 8, -3],
        cubes: [
          { origin: [-4, 4, -9], size: [8, 6, 6], uv: [0, 0] },
          { origin: [-4, 10, -8], size: [2, 2, 1], uv: [0, 0] },
          { origin: [2, 10, -8], size: [2, 2, 1], uv: [22, 0] },
          { origin: [-2, 4, -12], size: [4, 2, 3], uv: [0, 24] },
        ],
      },
      {
        name: "leg0",
        parent: "body",
        pivot: [-3, 6, 6],
        cubes: [{ origin: [-3.005, 0, 5], size: [2, 6, 2], uv: [14, 24] }],
      },
      {
        name: "leg1",
        parent: "body",
        pivot: [1, 6, 6],
        cubes: [{ origin: [1.005, 0, 5], size: [2, 6, 2], uv: [22, 24] }],
      },
      {
        name: "leg2",
        parent: "body",
        pivot: [-3, 6, -1],
        cubes: [{ origin: [-3.005, 0, -2], size: [2, 6, 2], uv: [14, 24] }],
      },
      {
        name: "leg3",
        parent: "body",
        pivot: [1, 6, -1],
        cubes: [{ origin: [1.005, 0, -2], size: [2, 6, 2], uv: [22, 24] }],
      },
      {
        name: "tail",
        parent: "body",
        pivot: [0, 8, 7],
        cubes: [{ origin: [-2, -2, 4.75], size: [4, 9, 5], uv: [28, 0] }],
      },
    ],
  },

  dragon: {
    texWidth: 256,
    texHeight: 256,
    bones: [
      { name: "root", pivot: [0, 24, 0] },
      {
        name: "head",
        parent: "root",
        pivot: [0, 24, 0],
        cubes: [
          { origin: [-6, 20, -24], size: [12, 5, 16], uv: [176, 44] },
          { origin: [-8, 16, -10], size: [16, 16, 16], uv: [112, 30] },
          { origin: [-5, 32, -4], size: [2, 4, 6], uv: [0, 0] },
          { origin: [3, 32, -4], size: [2, 4, 6], uv: [0, 0] },
          { origin: [-5, 25, -22], size: [2, 2, 4], uv: [112, 0] },
          { origin: [3, 25, -22], size: [2, 2, 4], uv: [112, 0] },
        ],
      },
      {
        name: "jaw",
        parent: "head",
        pivot: [0, 20, -8],
        cubes: [{ origin: [-6, 16, -24], size: [12, 4, 16], uv: [176, 65] }],
      },
      {
        name: "neck",
        parent: "root",
        pivot: [0, 24, 0],
        cubes: [
          { origin: [-5, 19, -5], size: [10, 10, 10], uv: [192, 104] },
          { origin: [-1, 29, -3], size: [2, 4, 6], uv: [48, 0] },
        ],
      },
      {
        name: "body",
        parent: "root",
        pivot: [0, 20, 8],
        cubes: [
          { origin: [-12, -4, -8], size: [24, 24, 64], uv: [0, 0] },
          { origin: [-1, 20, -2], size: [2, 6, 12], uv: [220, 53] },
          { origin: [-1, 20, 18], size: [2, 6, 12], uv: [220, 53] },
          { origin: [-1, 20, 38], size: [2, 6, 12], uv: [220, 53] },
        ],
      },
      {
        name: "wingL",
        parent: "body",
        pivot: [-12, 19, 2],
        cubes: [
          { origin: [-68, 15, -2], size: [56, 8, 8], uv: [112, 88] },
          { origin: [-68, 19, 4], size: [56, 0, 56], uv: [-56, 88] },
        ],
      },
      {
        name: "wingtipL",
        parent: "wingL",
        pivot: [-56, 24, 0],
        cubes: [
          { origin: [-112, 22, -2], size: [56, 4, 4], uv: [112, 136] },
          { origin: [-112, 24, 2], size: [56, 0, 56], uv: [-56, 144] },
        ],
      },
      {
        name: "wingR",
        parent: "body",
        pivot: [12, 19, 2],
        cubes: [
          { origin: [12, 15, -2], size: [56, 8, 8], uv: [112, 88], mirror: true },
          { origin: [12, 19, 4], size: [56, 0, 56], uv: [-56, 88], mirror: true },
        ],
      },
      {
        name: "wingtipR",
        parent: "wingR",
        pivot: [56, 24, 0],
        cubes: [
          { origin: [56, 22, -2], size: [56, 4, 4], uv: [112, 136], mirror: true },
          { origin: [56, 24, 2], size: [56, 0, 56], uv: [-56, 144], mirror: true },
        ],
      },
    ],
  },

  cow: {
    texWidth: 64,
    texHeight: 64,
    bones: [
      { name: "root", pivot: [0, 0, -1] },
      {
        name: "head",
        parent: "root",
        pivot: [0, 20, -9],
        cubes: [
          { origin: [-4, 16, -15], size: [8, 8, 6], uv: [0, 0] },
          { origin: [-3, 16, -16], size: [6, 3, 1], uv: [1, 33] },
          { origin: [-5, 22, -14], size: [1, 3, 1], uv: [22, 0] },
          { origin: [4, 22, -14], size: [1, 3, 1], uv: [22, 0] },
        ],
      },
      {
        name: "body",
        parent: "root",
        pivot: [0, 19, 1],
        cubes: [
          { origin: [-6, 29, 14], size: [12, 18, 10], pivot: [0, 18, 20], rotation: [90, 0, 0], uv: [18, 4] },
          { origin: [-2, 29, 13], size: [4, 6, 1], pivot: [0, 18, 20], rotation: [90, 0, 0], uv: [52, 0] },
        ],
      },
      {
        name: "leg0",
        parent: "root",
        pivot: [-4, 12, 6],
        cubes: [{ origin: [-6, 0, 4], size: [4, 12, 4], uv: [0, 16] }],
      },
      {
        name: "leg1",
        parent: "root",
        pivot: [4, 12, 6],
        cubes: [{ origin: [2, 0, 4], size: [4, 12, 4], uv: [0, 16], mirror: true }],
      },
      {
        name: "leg2",
        parent: "root",
        pivot: [-4, 12, -7],
        cubes: [{ origin: [-6, 0, -8], size: [4, 12, 4], uv: [0, 16] }],
      },
      {
        name: "leg3",
        parent: "root",
        pivot: [4, 12, -7],
        cubes: [{ origin: [2, 0, -8], size: [4, 12, 4], uv: [0, 16], mirror: true }],
      },
    ],
  },

  pig: {
    texWidth: 64,
    texHeight: 64,
    bones: [
      { name: "root", pivot: [0, 0, 0] },
      {
        name: "head",
        parent: "root",
        pivot: [0, 12, -7],
        cubes: [
          { origin: [-4, 8, -15], size: [8, 8, 8], uv: [0, 0] },
          { origin: [-2, 9, -16], size: [4, 3, 1], uv: [16, 16] },
        ],
      },
      {
        name: "body",
        parent: "root",
        pivot: [0, 0, 0],
        cubes: [
          { origin: [-5, 2, -5], size: [10, 16, 8], inflate: 0.5, rotation: [90, 0, 0], uv: [28, 32] },
          { origin: [-5, 2, -5], size: [10, 16, 8], rotation: [90, 0, 0], uv: [28, 8] },
        ],
      },
      {
        name: "leg0",
        parent: "root",
        pivot: [-3, 6, 6],
        cubes: [{ origin: [-5, 0, 4], size: [4, 6, 4], uv: [0, 16] }],
      },
      {
        name: "leg1",
        parent: "root",
        pivot: [3, 6, 6],
        cubes: [{ origin: [1, 0, 4], size: [4, 6, 4], uv: [0, 16], mirror: true }],
      },
      {
        name: "leg2",
        parent: "root",
        pivot: [-3, 6, -6],
        cubes: [{ origin: [-5, 0, -8], size: [4, 6, 4], uv: [0, 16] }],
      },
      {
        name: "leg3",
        parent: "root",
        pivot: [3, 6, -6],
        cubes: [{ origin: [1, 0, -8], size: [4, 6, 4], uv: [0, 16], mirror: true }],
      },
    ],
  },

  frog: {
    texWidth: 48,
    texHeight: 48,
    bones: [
      { name: "root", pivot: [0, 0, 0] },
      {
        name: "body",
        parent: "root",
        pivot: [0, 2, 4],
        cubes: [
          { origin: [-3.5, 1, -4], size: [7, 3, 9], uv: [3, 1] },
          { origin: [-3.5, 3, -4], size: [7, 0, 9], uv: [23, 22] },
        ],
      },
      {
        name: "head",
        parent: "body",
        pivot: [0, 4, 3],
        cubes: [
          { origin: [-3.5, 5, -4], size: [7, 0, 9], uv: [23, 13] },
          { origin: [-3.5, 3, -4], size: [7, 3, 9], uv: [0, 13] },
        ],
      },
      {
        name: "right_eye",
        parent: "head",
        pivot: [-2, 7, -1.5],
        cubes: [{ origin: [-3.5, 6, -3], size: [3, 2, 3], uv: [0, 0] }],
      },
      {
        name: "left_eye",
        parent: "head",
        pivot: [2, 7, -1.5],
        cubes: [{ origin: [0.5, 6, -3], size: [3, 2, 3], uv: [0, 5] }],
      },
      {
        name: "tongue",
        parent: "body",
        pivot: [0, 3.1, 5],
        cubes: [{ origin: [-2, 3.1, -2.1], size: [4, 0, 7], uv: [17, 13] }],
      },
      {
        name: "left_arm",
        parent: "body",
        pivot: [4, 3, -2.5],
        cubes: [
          { origin: [3, 0, -3.5], size: [2, 3, 3], uv: [0, 32] },
          { origin: [0, -0.01, -7.5], size: [8, 0, 8], uv: [18, 40] },
        ],
      },
      {
        name: "right_arm",
        parent: "body",
        pivot: [-4, 3, -2.5],
        cubes: [
          { origin: [-5, 0, -3.5], size: [2, 3, 3], uv: [0, 38] },
          { origin: [-8, -0.01, -7.5], size: [8, 0, 8], uv: [2, 40] },
        ],
      },
      {
        name: "left_leg",
        parent: "root",
        pivot: [3.5, 3, 4],
        cubes: [
          { origin: [2.5, 0, 2], size: [3, 3, 4], uv: [14, 25] },
          { origin: [1.5, -0.01, 0], size: [8, 0, 8], uv: [2, 32] },
        ],
      },
      {
        name: "right_leg",
        parent: "root",
        pivot: [-3.5, 3, 4],
        cubes: [
          { origin: [-5.5, 0, 2], size: [3, 3, 4], uv: [0, 25] },
          { origin: [-9.5, -0.01, 0], size: [8, 0, 8], uv: [18, 32] },
        ],
      },
    ],
  },

  axolotl: {
    texWidth: 64,
    texHeight: 64,
    bones: [
      { name: "root", pivot: [0, -4, 0] },
      {
        name: "body",
        parent: "root",
        pivot: [0, 3, 4],
        cubes: [
          { origin: [-4, 0, -5], size: [8, 4, 10], uv: [0, 11] },
          { origin: [0, 0, -5], size: [0, 5, 9], uv: [2, 17] },
        ],
      },
      {
        name: "right_arm",
        parent: "body",
        pivot: [-4, 1, -4],
        rotation: [0, -90, 0],
        cubes: [{ origin: [-6, -4, -4], size: [3, 5, 0], uv: [2, 13] }],
      },
      {
        name: "right_leg",
        parent: "body",
        pivot: [-4, 1, 4],
        rotation: [0, 90, 0],
        cubes: [{ origin: [-5, -4, 4], size: [3, 5, 0], uv: [2, 13] }],
      },
      {
        name: "left_arm",
        parent: "body",
        pivot: [4, 1, -4],
        rotation: [0, 90, 0],
        cubes: [{ origin: [3, -4, -4], size: [3, 5, 0], uv: [2, 13] }],
      },
      {
        name: "left_leg",
        parent: "body",
        pivot: [4, 1, 4],
        rotation: [0, -90, 0],
        cubes: [{ origin: [2, -4, 4], size: [3, 5, 0], uv: [2, 13] }],
      },
      { name: "tail", parent: "body", pivot: [0, 2, 4], cubes: [{ origin: [0, 0, 4], size: [0, 5, 12], uv: [2, 19] }] },
      {
        name: "head",
        parent: "body",
        pivot: [0, 2, -5],
        cubes: [{ origin: [-4, 0, -10], size: [8, 5, 5], uv: [0, 1] }],
      },
      {
        name: "left_gills",
        parent: "head",
        pivot: [4, 2, -6],
        cubes: [{ origin: [4, 0, -6], size: [3, 7, 0], uv: [11, 40] }],
      },
      {
        name: "right_gills",
        parent: "head",
        pivot: [-4, 2, -6],
        cubes: [{ origin: [-7, 0, -6], size: [3, 7, 0], uv: [0, 40] }],
      },
      {
        name: "top_gills",
        parent: "head",
        pivot: [0, 5, -6],
        cubes: [{ origin: [-4, 5, -6], size: [8, 3, 0], uv: [3, 37] }],
      },
    ],
  },
};

export default MOB_GEOMETRY;
