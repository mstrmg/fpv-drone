// Wind: a slowly wandering mean wind plus gusts (Ornstein–Uhlenbeck noise).

function gaussian(rand) {
  const u = Math.max(1e-9, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Wind {
  constructor({ meanSpeed = 3, gustStrength = 1.8, gustTime = 2.5, seed = 11 } = {}) {
    let a = seed >>> 0;
    this.rand = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    this.meanSpeed = meanSpeed;
    this.gustStrength = gustStrength;
    this.gustTime = gustTime;
    this.heading = this.rand() * Math.PI * 2;
    this.gust = [0, 0, 0];
    this.value = [0, 0, 0];
  }

  // Wind is weaker near the ground (boundary layer).
  step(dt, altitudeAgl) {
    this.heading += gaussian(this.rand) * 0.02 * Math.sqrt(dt);
    const k = dt / this.gustTime;
    const sigma = this.gustStrength * Math.sqrt(2 * k);
    for (let i = 0; i < 3; i++) {
      const s = i === 1 ? sigma * 0.35 : sigma;
      this.gust[i] += -this.gust[i] * k + s * gaussian(this.rand);
    }
    const shear = Math.min(1, Math.max(0.15, Math.log1p(Math.max(0, altitudeAgl)) / Math.log1p(40)));
    this.value[0] = (Math.sin(this.heading) * this.meanSpeed + this.gust[0]) * shear;
    this.value[1] = this.gust[1] * shear;
    this.value[2] = (-Math.cos(this.heading) * this.meanSpeed + this.gust[2]) * shear;
    return this.value;
  }
}
