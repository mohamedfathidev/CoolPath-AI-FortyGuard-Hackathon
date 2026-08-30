# CoolPath AI — Submission Summary

Heat-aware walking routes and urban heat-island mapping for Phoenix.

---

## The problem

Phoenix summers turn walking into a health risk. Central blocks sit above 95°F for more
than 13 hours a day, and that heat hits pedestrians hardest — the commuter finishing the
last half-mile from the bus stop, the student crossing campus, the delivery rider on foot,
anyone who doesn't have a car to escape into. The maps they rely on don't help. Every
routing app chases the same number: distance. It happily sends someone down the shortest,
most sun-blasted street without any idea of how much heat they'll absorb along the way. And
with each Phoenix summer arriving hotter and lasting longer, that gap keeps widening.

## Who it's for

CoolPath is aimed at the people who actually own the sidewalk. Transit agencies can offer
heat-aware first and last-mile directions. Universities and large campuses can steer foot
traffic away from their most exposed ground during peak heat. City walkability and
climate-resilience offices get a map that shows exactly where shade, tree canopy, and
reflective surfaces would do the most good. And because the routing engine is also a plain
REST API, delivery and mobility companies can drop the "coolest route" straight into their
own apps to protect the riders and drivers already out in the heat.

## How FortyGuard powers it

The whole product runs on FortyGuard's Temperature API. We pull instantaneous street-level
temperature from `/v1/heatmap` (tcm) to show people how hot it is right now, and daily
hours-above-threshold from `/v1/heatmap` (exceedance) — the number that actually weights our
routing and paints the heat-island map. `/v1/env_params` fills in the heat index, humidity,
and air quality that explain *why* a given block is punishing, and `/v1/heat_intelligence`
backs the agent's deeper reports. Behind all of it, `/v1/status` drives the async
submit-and-poll flow and the credit-usage endpoint lets the app police its own spending.
Every call is validated for U.S. coverage and the supported dates, cached in Postgres so we
never pay twice for the same query, and made with the API key kept safely server-side.

## What we measured

Building against live data taught us the whole thing. We assumed we'd route by temperature
— until the data showed that, block to block, the temperature barely moves (about half a
degree). What *does* move is cumulative exposure: one street can bake one to three hours
longer than the next. So CoolPath routes on hours of heat, not degrees. Across central
Phoenix the hottest blocks endure 13.4 hours a day above 95°F — a full 3.0 hours more than
the coolest, shaded pockets. That gap is the urban heat island, made visible. And every
route pays it back in something concrete: walking from Encanto Park to St Gregory Parish
Hall, for instance, costs just 26 extra meters to shed 0.18 hours a day of extreme-heat
exposure. All of it ships live — a map planner, a natural-language AI agent making six real
FortyGuard tool calls, and a city heat-island map — across roughly 16 km² of Phoenix.
