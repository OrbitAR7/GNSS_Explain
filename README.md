# GNSS Explain

An interactive simulation that shows how satellite navigation works, built for teaching.

I built it as a teaching aid for space-academy courses in Saudi Arabia, to give students a way to
*see* what a GNSS receiver does instead of only reading the equations. It shows the four global
navigation satellite systems (GPS, Galileo, GLONASS, BeiDou) at their actual positions, and a
smartphone receiver (Riyadh by default) acquiring their signals and computing a position and time
fix, using the same measurement model and solution method as a real receiver.

A guided sequence of chapters walks through ranging, the receiver-clock problem, why four satellites
are needed, multi-constellation solutions, geometry (DOP), error sources and the signal environment,
with live values from the simulation. Everything can also be driven freely, so an instructor can
change a condition in front of the class and students can see the effect on the fix.

## Running

Requires Node.js 18 or newer.

```bash
npm install          # also copies CesiumJS runtime assets into public/cesium
npm run dev          # http://localhost:5173
```

| Command | Purpose |
| --- | --- |
| `npm run build` | Type-check and build a static site into `dist/` (serve with any web server) |
| `npm test` | Unit tests (geodesy, element sets, atmosphere, link budget, PVT solver, receiver) |
| `npm run lint` | ESLint |
| `npm run update-elements` | Refresh the bundled orbital elements from CelesTrak |

## Orbital data

Satellite orbits are propagated with SGP4 (satellite.js) from CelesTrak's published element sets:
groups `gps-ops`, `galileo`, `glo-ops` and `beidou`. At start-up the browser fetches current
elements (cached for 2 hours, CelesTrak's requested minimum interval); if that fails it uses the
snapshot in `public/data/elements/`, so the simulator works offline. `manifest.json` records when
and from where the snapshot was taken, with SHA-256 hashes. Every element set is checksum-validated.

Each satellite is matched by NORAD catalogue number to `src/gnss/catalogData.ts`, which records its
PRN, block, orbit type, plane/slot, GLONASS frequency channel and service status. Only satellites
marked healthy are used in the position solution; others are shown and tracked but flagged.

## Model

| Area | Implementation |
| --- | --- |
| Orbits | SGP4, TEME rotated to Earth-fixed with GMST. Earth-fixed velocity includes the rotation term (used for Doppler and light time). |
| Signals | GPS L1 C/A, Galileo E1 OS, GLONASS L1OF (per-satellite FDMA channel), BeiDou B1I. Parameters in `src/gnss/systems.ts`, each referenced to its interface specification. |
| Received power | Anchored to the specified minimum received power plus a typical margin, with path-length change and the satellite antenna's limb-to-nadir gain taper; smartphone antenna gain pattern; obstruction losses. C/N0 from kT, noise figure and implementation loss. |
| Acquisition | Assisted (A-GNSS) and standalone start modes with C/N0 thresholds. Usability follows the navigation-message structure: a time tag (GPS 6 s subframe, Galileo 2 s page, GLONASS 2 s string, BeiDou 6 s / 0.6 s) and, without assistance, the full ephemeris (30 s repetition). |
| Pseudoranges | Light-time solution with Earth rotation (Sagnac); receiver clock bias and drift with 1 ms steering; inter-system biases; satellite orbit/clock error (Gauss–Markov, per-system SISRE); ionosphere (Klobuchar-shaped truth at solar-maximum level with irregularities, frequency-scaled); troposphere (Saastamoinen with local weather); multipath (environment dependent); non-line-of-sight excess path in urban canyons; code tracking noise from the DLL thermal-noise formula. |
| Corrections | Broadcast Klobuchar model (GPS, GLONASS, BeiDou), NeQuick-G performance for Galileo, Saastamoinen with a standard atmosphere. |
| Solution | Iterative weighted least squares: position plus one clock per constellation; altitude aiding (2D fix) when one measurement short; GDOP/PDOP/HDOP/VDOP/TDOP; 95 % horizontal accuracy as 2·HDOP·σ. |
| Environments | Open sky; urban street canyon (geometric roof-line, reflections with excess path); indoors (structure attenuation and multipath). |

Not modelled: satellite-side relativistic and group-delay terms (assumed corrected), carrier-phase
processing, velocity, dual-frequency measurements, regional systems (QZSS, NavIC) and SBAS.

## Project layout

```
src/gnss/        Simulation engine (no UI dependencies)
  constants.ts   Physical constants, WGS-84
  systems.ts     Constellation and signal parameters
  catalog*.ts    Satellite catalogue (PRN, block, status)
  elements.ts    Two-line element parsing and validation
  satellite.ts   SGP4 propagation to Earth-fixed position and velocity
  geodesy.ts     WGS-84 conversions, local frames, look angles
  time.ts        GPS time
  atmosphere.ts  Klobuchar, Saastamoinen, mapping function
  signal.ts      Link budget, C/N0, code tracking noise
  environment.ts Open sky, urban canyon, indoor
  measurement.ts Light-time solution and error terms
  pvt.ts         Least-squares position/time solution and DOP
  receiver.ts    Receiver: channels, acquisition, measurements, fix
src/threats/     Hook points for jamming and spoofing scenarios
src/app/         Application state, orbit loading, places
src/view/        Globe (CesiumJS), phone, briefing, controls, inspector
tests/           Vitest unit tests
scripts/         Asset copy and element refresh
```

## Interference scenarios (next module)

`src/threats/index.ts` defines the hooks the receiver already calls on every update:
`noiseRiseDb` (jamming: raises the noise floor so C/N0 falls), `adjustObservation`
(per-satellite signal changes) and `adjustMeasurements` (spoofing: replaces the pseudoranges
entering the solution). Register a scenario with `registerThreat`.

## Data and software credits

- Orbital elements: [CelesTrak](https://celestrak.org) (T.S. Kelso)
- 3D globe: [CesiumJS](https://cesium.com/platform/cesiumjs/) (Apache-2.0) with bundled Natural Earth II imagery
- Online imagery and place names: Esri World Imagery and World Boundaries and Places
- SGP4: [satellite.js](https://github.com/shashwatak/satellite-js) (MIT)
- Typeface: IBM Plex (SIL Open Font License)

## Author

Hamoud Alshammari, aerospace engineer. Educational use; orbital data and imagery belong to their
respective providers (see credits above).
