"""Maps/geocoding adapter. Location assistance is optional by design."""

from __future__ import annotations

import httpx

from app.core.config import settings


def provider_status() -> dict:
    configured = {
        "none": True,
        "google": bool(settings.google_maps_api_key),
        "mapbox": bool(settings.mapbox_access_token),
    }
    return {
        "provider": settings.maps_provider,
        "configured": configured.get(settings.maps_provider, False),
        "enabled": settings.maps_provider != "none",
    }


def geocode(query: str) -> dict | None:
    if settings.maps_provider == "google" and settings.google_maps_api_key:
        response = httpx.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"address": query, "region": "in", "key": settings.google_maps_api_key},
            timeout=15,
        )
        response.raise_for_status()
        results = response.json().get("results") or []
        if not results:
            return None
        result = results[0]
        loc = result["geometry"]["location"]
        return {
            "latitude": loc["lat"],
            "longitude": loc["lng"],
            "formatted_address": result.get("formatted_address"),
        }
    if settings.maps_provider == "mapbox" and settings.mapbox_access_token:
        response = httpx.get(
            "https://api.mapbox.com/geocoding/v5/mapbox.places/"
            + httpx.URL(query).raw_path.decode()
            + ".json",
            params={
                "access_token": settings.mapbox_access_token,
                "country": "in",
                "limit": 1,
            },
            timeout=15,
        )
        response.raise_for_status()
        features = response.json().get("features") or []
        if not features:
            return None
        lng, lat = features[0]["center"]
        return {
            "latitude": lat,
            "longitude": lng,
            "formatted_address": features[0].get("place_name"),
        }
    return None
