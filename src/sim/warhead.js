// Warheads carried by the strike drone, and the blast / fragment damage model.
//
// Damage is handed to "damageables" (future troops and vehicles) through a small
// registry, so targets decide their own vulnerability (armour, cover, weak spots).

export const WARHEADS = {
  none: { type: 'none', massKg: 0, chargeKg: 0, radius: 0, fragmentRadius: 0, fragmentLethality: 0, shaped: false, penetrationMm: 0, lengthM: 0 },
  // RPG-7 style tandem/HEAT round strapped under the frame: anti-armour, small blast.
  'rpg-heat': {
    type: 'rpg-heat', massKg: 1.2, chargeKg: 0.7, radius: 3, fragmentRadius: 12,
    fragmentLethality: 0.35, shaped: true, penetrationMm: 450, lengthM: 0.36,
  },
  // OG-7 style fragmentation round: anti-personnel, big fragment cloud.
  frag: {
    type: 'frag', massKg: 1.0, chargeKg: 0.4, radius: 5, fragmentRadius: 25,
    fragmentLethality: 0.9, shaped: false, penetrationMm: 0, lengthM: 0.3,
  },
};

export const ARM_DISTANCE_M = 25;   // safety: arms only this far from the launch point
export const FUZE_IMPACT_SPEED = 3; // m/s of impact that sets off the contact fuze
export const JET_REACH_M = 1.5;     // HEAT jet only works on a target right in front

/**
 * Damage components at `distance` metres from the surface of a target.
 * blast: 1 inside the lethal radius, then falls off with the cube of distance
 *        (peak overpressure ∝ 1/Z³ in the near field).
 * fragments: falls off with the square of distance (fragment density on a
 *        sphere) and fades to zero at the fragment radius.
 */
export function blastAt(distance, w) {
  if (!w || w.chargeKg <= 0) return { blast: 0, fragments: 0 };
  const d = Math.max(0, distance);
  const blast = d <= w.radius ? 1 : Math.pow(w.radius / d, 3);
  let fragments = 0;
  if (d < w.fragmentRadius) {
    const near = Math.min(1, Math.pow(w.radius / Math.max(d, 0.01), 2));
    fragments = w.fragmentLethality * near * Math.sqrt(1 - d / w.fragmentRadius);
  }
  return { blast: blast < 0.005 ? 0 : blast, fragments };
}

export class DamageRegistry {
  constructor() { this.targets = new Map(); }

  /**
   * target = {
   *   id: string,
   *   position(): [x,y,z],      // centre
   *   radius: number,           // rough size, m
   *   bodyHandle?: number,      // Rapier rigid body to ignore in the line-of-sight ray
   *   applyDamage(hit): number, // returns damage dealt (0..1 of its health); hit fields below
   * }
   * hit = { blast, fragments, jet, distance, lineOfSight, penetrationMm, direction, position }
   */
  register(target) { this.targets.set(target.id, target); return () => this.targets.delete(target.id); }
  unregister(id) { this.targets.delete(id); }
}
