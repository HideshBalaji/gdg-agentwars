import httpx

from ghost_dispatcher.services.store import DomainError
from ghost_dispatcher.services.validation import distance_km


class Router:
    def __init__(self, settings):
        self.settings = settings

    async def leg(self, origin, destination):
        if self.settings.mode == "offline":
            km = distance_km(origin, destination) * 1.3
            return {"km": km, "minutes": km / 40 * 60, "source": "simulated_40_kmh"}
        if not self.settings.maps_key:
            raise DomainError("not_configured", "Live routing requires GOOGLE_MAPS_API_KEY", 503)
        async with httpx.AsyncClient(timeout=15) as client:
            result = await client.post(
                "https://routes.googleapis.com/directions/v2:computeRoutes",
                headers={
                    "X-Goog-Api-Key": self.settings.maps_key,
                    "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
                },
                json={
                    "origin": {
                        "location": {"latLng": {"latitude": origin.lat, "longitude": origin.lng}}
                    },
                    "destination": {
                        "location": {
                            "latLng": {"latitude": destination.lat, "longitude": destination.lng}
                        }
                    },
                    "travelMode": "DRIVE",
                    "routingPreference": "TRAFFIC_AWARE",
                },
            )
            result.raise_for_status()
            routes = result.json().get("routes", [])
            if not routes:
                raise DomainError("route_unavailable", "Google Routes returned no route", 503)
            return {
                "km": routes[0]["distanceMeters"] / 1000,
                "minutes": float(routes[0]["duration"].removesuffix("s")) / 60,
                "source": "google_maps_routes",
            }
