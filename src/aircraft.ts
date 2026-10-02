export const AIRCRAFT_REVISION = '6';
export const aircraftAsset = (id: string) => './art/' + id + '.svg?v=' + AIRCRAFT_REVISION;

type Point = { x: number; y: number };
type Airframe = { engine: 'piston' | 'jet'; exhaust: Point[]; propeller?: Point };
// Coordinates in the shared SVG viewBox, before sprite rotation and mirroring.
export const AIRCRAFT_ART: Record<string, Airframe> = {
  universal: { engine: 'piston', exhaust: [{ x: 306, y: 111 }], propeller: { x: 373, y: 108 } },
  swift: { engine: 'jet', exhaust: [{ x: 47, y: 109 }] },
  bastion: { engine: 'jet', exhaust: [{ x: 42, y: 106 }, { x: 46, y: 123 }] },
  skate: { engine: 'jet', exhaust: [{ x: 43, y: 111 }] },
  enemy: { engine: 'jet', exhaust: [{ x: 47, y: 109 }] },
  'enemy-heavy': { engine: 'jet', exhaust: [{ x: 42, y: 106 }, { x: 46, y: 123 }] },
  'enemy-boss': { engine: 'jet', exhaust: [{ x: 43, y: 111 }] },
};
