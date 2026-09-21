# PRODIGY_WD_05

A real-time weather web app built with plain **HTML, CSS and JavaScript** (no frameworks, no build step, no API key).
Built for **Task 05 – Weather App** (Prodigy Infotech web development internship).

> Build a web page that fetches weather data from a weather API based on the user's location or a user-inputted location. Display the current weather conditions, temperature, and other relevant information.

## How to run

**Easiest:** double-click `index.html` – it opens in your browser and works straight away.

**Recommended (for the "use my location" button):** browsers are stricter about location access on `file://` pages, so serve the folder locally:

```bash
# inside the weather-app folder
python -m http.server 5500
# then open http://localhost:5500
```

or use the **Live Server** extension in VS Code (right-click `index.html` → *Open with Live Server*).
An internet connection is required (the app calls live weather APIs).

## Features

| Requirement | What the app does |
|---|---|
| Weather from the user's location | "Use my location" button (and automatic on first visit) uses the browser Geolocation API, then reverse-geocodes the coordinates to a place name |
| Weather from a user-inputted location | Search box with live suggestions (debounced), keyboard navigation (↑ ↓ Enter Esc), recent searches, and clear "not found" / error messages |
| Current conditions & temperature | Big temperature, condition text with animated icon, feels-like, today's high/low, and a one-line rain outlook |
| Other relevant information | Humidity and dew point, wind speed / direction / gusts, pressure and trend, visibility, UV index, cloud cover, precipitation, air quality (US AQI + PM2.5), sunrise / sunset with sun-position arc |
| Forecast | Next-24-hours strip with temperature curve and rain chance; 7-day forecast with temperature range bars |

Extras that make it feel like a real product:

- Sky, colours and particles react to the actual weather and to day/night at that location (rain, snow, stars, drifting clouds, lightning).
- °C / °F toggle (also switches km/h ↔ mph, hPa ↔ inHg, mm ↔ in). Remembered between visits.
- Save favourite places (star button) and jump between them with one click.
- Shows the **local time of the searched place**.
- Auto-refreshes every 10 minutes and when you return to the tab.
- Loading indicator, offline / API-failure message with a "Try again" button.
- Responsive from phones to desktops, keyboard accessible, respects "reduce motion".

## Project structure

```
weather-app/
├── index.html   # page structure
├── style.css    # design, layout, animations, responsive rules
├── script.js    # API calls, rendering, search, geolocation, sky effects
└── README.md
```

## APIs used (all free, no key needed)

- [Open-Meteo Forecast API](https://open-meteo.com/en/docs) – current, hourly and daily weather
- [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) – city search
- [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) – AQI and PM2.5
- [BigDataCloud reverse geocoding](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api) – turns GPS coordinates into a place name

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0). Free for non-commercial use.

## Customising

- Change the fallback city in `script.js` → `DEFAULT_PLACE`.
- Change sky colours in `script.js` → `SKY`.
- Change the name/branding in `index.html` (`Nimbus`) and the `<title>`.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Location access is blocked" | Click the lock icon in the address bar → allow Location → press the location button again. Or just search for your city. |
| Location doesn't work when opening the file directly | Run it through a local server (see *How to run*). |
| "Couldn't load the weather" | Check your internet connection; then press **Try again**. |
| Fonts look different | Fonts load from Google Fonts; offline it falls back to system fonts. |
