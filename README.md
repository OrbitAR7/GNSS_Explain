# GNSS Explain

**An interactive satellite navigation simulator developed as a teaching aid for the Saudi Space Agency's Space Academy courses.**

GNSS Explain is a physics-based, interactive simulation I developed to help students understand how Global Navigation Satellite Systems (GNSS) work. Rather than learning only from equations and diagrams, students can *see* how a receiver acquires satellite signals, measures ranges, and solves for position and time.

The simulator displays the four global navigation satellite systems—**GPS, Galileo, GLONASS, and BeiDou**—at positions propagated from published orbital element sets. A simulated smartphone receiver, located in **Riyadh, Saudi Arabia** by default, acquires available signals and estimates its position and receiver clock offset using pseudorange measurements and an iterative weighted least-squares solver.

Guided chapters walk students through satellite ranging, the receiver clock problem, why four satellites are needed for a standalone 3D position-and-time fix, multi-constellation navigation, satellite geometry and dilution of precision (DOP), measurement errors, and signal reception in different environments. The values and visualizations are driven by the simulation rather than being static illustrations.

Instructors can also use the simulator freely: change a condition in front of the class and show students how satellite visibility, signal strength, acquisition, solution availability, and positioning accuracy respond.

> **Educational context:** Developed independently as a teaching aid for Space Academy courses offered by the **Saudi Space Agency (SSA)**. This project is not presented as an official Saudi Space Agency software product or endorsement.

## Running

Requires **Node.js 18 or newer**.

```bash
npm install          # Also copies CesiumJS runtime assets into public/cesium
npm run dev          # Open http://localhost:5173
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server. |
| `npm run build` | Type-check and build a static site in `dist/` (serve it with any web server). |
| `npm test` | Run unit tests covering geodesy, element sets, atmosphere, link budget, PVT solver, and receiver. |
| `npm run lint` | Run ESLint. |
| `npm run update-elements` | Refresh bundled orbital element sets from CelesTrak. |

## Orbital data

Satellite orbits are propagated using **SGP4**, via [`satellite.js`](https://github.com/shashwatak/satellite-js), from [CelesTrak](https://celestrak.org)'s published element sets:

- `gps-ops` — GPS
- `galileo` — Galileo
- `glo-ops` — GLONASS
- `beidou` — BeiDou

At startup, the browser attempts to fetch current orbital elements. Fetched data is cached for **two hours**, respecting CelesTrak's requested minimum refresh interval. If the network request fails, the simulator uses the bundled snapshot in `public/data/elements/`, allowing the application to work offline after its assets have been installed or deployed.

The snapshot's `manifest.json` records when and where the data was obtained and includes **SHA-256 hashes**. Every element set is checksum-validated.

Each satellite is matched by **NORAD catalog number** to `src/gnss/catalogData.ts`, which records its PRN, block, orbit type, plane/slot, GLONASS frequency channel, and service status. Only satellites identified as healthy are eligible for the position solution; others remain visible and trackable but are flagged accordingly.

Orbital element accuracy depends on the age and quality of the available data. SGP4 propagation is used for educational visualization and is not a substitute for a GNSS broadcast-ephemeris navigation engine.

## Simulation model

| Area | Implementation |
| --- | --- |
| **Orbits** | SGP4 propagation. TEME coordinates are rotated into Earth-fixed coordinates using Greenwich mean sidereal time (GMST). Earth-fixed velocity includes the Earth-rotation term, used in Doppler and light-time calculations. |
| **Signals** | GPS L1 C/A; Galileo E1 OS; GLONASS L1OF, including per-satellite FDMA frequency channels; and BeiDou B1I. Parameters are defined in `src/gnss/systems.ts`, with references to the corresponding interface specifications. |
| **Received power** | Specified minimum received power plus a representative margin, adjusted for path-length variation, satellite antenna gain taper from nadir to limb, smartphone antenna gain pattern, and obstruction losses. Carrier-to-noise-density ratio (C/N₀) is calculated using thermal noise (kT), receiver noise figure, and implementation losses. |
| **Acquisition** | Assisted (A-GNSS) and standalone start modes with C/N₀ thresholds. Usability reflects navigation-message timing: GPS 6 s subframe, Galileo 2 s page, GLONASS 2 s string, and BeiDou 6 s / 0.6 s timing. Without assistance, acquisition also waits for a full ephemeris cycle (approximately 30 s repetition in the simplified model). |
| **Pseudoranges** | Signal light-time calculation with Earth-rotation (Sagnac) correction; receiver clock bias and drift with 1 ms steering; inter-system biases; satellite orbit and clock errors modeled with Gauss–Markov processes and per-system SISRE; ionospheric delay; tropospheric delay; multipath; non-line-of-sight excess paths; and code-tracking noise. |
| **Ionosphere** | Klobuchar-shaped truth delays at a solar-maximum reference level, including irregularities and frequency-dependent scaling. |
| **Troposphere** | Saastamoinen delay model with local weather parameters. |
| **Code tracking** | Delay-lock-loop (DLL) thermal-noise-based approximation. |
| **Corrections** | Broadcast-style Klobuchar corrections for GPS, GLONASS, and BeiDou; NeQuick-G performance approximation for Galileo; and Saastamoinen corrections using a standard atmosphere. |
| **Position solution** | Iterative weighted least squares with receiver position and constellation-dependent clock terms. An altitude-aided 2D fix is available when the measurement geometry is one observation short of the full solution. |
| **Geometry and accuracy** | GDOP, PDOP, HDOP, VDOP, and TDOP. Approximate 95% horizontal accuracy is displayed as `2 × HDOP × σ` under the simulator's simplified measurement-noise assumption. |
| **Environments** | Open sky, urban street canyon (geometric roof-line and reflected paths), and indoors (structure attenuation and multipath). |

### What is not modeled

The current model does **not** simulate:

- Satellite-side relativistic and group-delay effects as independent error terms (assumed corrected).
- Carrier-phase processing or ambiguity resolution.
- Velocity estimation as a navigation solution output.
- Dual-frequency GNSS measurements.
- Regional navigation systems, including QZSS and NavIC.
- Satellite-based augmentation systems (SBAS).

**Scope note:** GNSS Explain is a teaching simulation. It uses physically informed models and a receiver-style weighted least-squares solution, but its assumptions and simplifications should not be interpreted as a validation of operational receiver performance.

## Learning experience

The guided sequence is organized around concepts students can observe and explore:

1. **Satellite ranging** — See how a receiver turns signal travel time into a pseudorange measurement.
2. **Receiver clock bias** — Understand why an inexpensive receiver clock creates a fourth unknown.
3. **Why four satellites?** — Explore the four-unknown 3D position-and-time solution, and what changes when altitude aiding or multiple constellations are involved.
4. **Multi-constellation GNSS** — Compare GPS, Galileo, GLONASS, and BeiDou observations and the role of inter-system timing biases.
5. **Satellite geometry and DOP** — See why the number of satellites alone does not determine positioning quality.
6. **Error sources** — Inspect the effects of atmospheric delays, satellite errors, multipath, and measurement noise.
7. **Signal environment** — Compare receiver behavior in open sky, urban canyons, and indoor conditions.

The guided chapters use live measurements from the same simulation engine available in free exploration mode.

## Project layout

```text
src/
  gnss/                 Simulation engine (no UI dependencies)
    constants.ts        Physical constants, WGS-84
    systems.ts          Constellation and signal parameters
    catalog*.ts         Satellite catalog (PRN, block, status)
    elements.ts         Two-line element parsing and validation
    satellite.ts        SGP4 propagation to Earth-fixed position and velocity
    geodesy.ts          WGS-84 conversions, local frames, look angles
    time.ts             GPS time
    atmosphere.ts       Klobuchar, Saastamoinen, mapping function
    signal.ts           Link budget, C/N0, code tracking noise
    environment.ts      Open sky, urban canyon, indoor
    measurement.ts      Light-time solution and error terms
    pvt.ts              Least-squares position/time solution and DOP
    receiver.ts         Receiver: channels, acquisition, measurements, fix
  threats/              Hooks for interference scenarios
  app/                  Application state, orbit loading, places
  view/                 Globe (CesiumJS), phone, briefing, controls, inspector
public/
  cesium/               Copied CesiumJS runtime assets
  data/elements/        Bundled orbital element sets and manifest
scripts/                 Asset copy and element refresh
tests/                   Vitest unit tests
```

## Interference scenarios (next module)

`src/threats/index.ts` defines hooks that the receiver already invokes on each update:

| Hook | Role |
| --- | --- |
| `noiseRiseDb` | Simulate jamming by increasing the effective receiver noise floor and reducing C/N₀. |
| `adjustObservation` | Modify an individual satellite signal or observation. |
| `adjustMeasurements` | Modify or replace pseudoranges before they enter the position solver, enabling spoofing scenarios. |

Register a scenario using `registerThreat`.

These interfaces establish the extension points for future interference demonstrations. They do **not** imply that the full jamming and spoofing teaching module is already implemented.

## Data and software credits

- **Orbital elements:** [CelesTrak](https://celestrak.org) (T. S. Kelso).
- **3D globe:** [CesiumJS](https://cesium.com/platform/cesiumjs/) (Apache-2.0), with bundled Natural Earth II imagery.
- **Online imagery and place names:** Esri World Imagery and World Boundaries and Places.
- **Orbital propagation:** [`satellite.js`](https://github.com/shashwatak/satellite-js) (MIT).
- **Typeface:** IBM Plex (SIL Open Font License).

Third-party code, orbital data, map content, and fonts retain their respective licenses and attribution requirements.

## Author

**Hamoud Alshammari**  
Aerospace Engineer

Developed for educational use in the context of the **Saudi Space Agency's Space Academy courses**. The simulator is independently developed; no official agency endorsement or ownership is implied.

