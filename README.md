⸻

Mapetite - Interactive Map-based Food Discovery App

Mapetite is a React-based application that helps users find the best food spots along their travel routes, leveraging Google Maps API and Leaflet. It integrates features like real-time geolocation, route planning, and autocomplete destination search to provide a seamless user experience when discovering nearby food places.

⸻

Table of Contents
	1.	Project Overview
	2.	Features
	3.	Technologies Used
	4.	Getting Started
	5.	Installation
	6.	Usage
	7.	Screenshots
	8.	Contributing
	9.	License

⸻

Project Overview

Mapetite is designed for travelers who want to optimize their food stops along their routes. It allows users to:
	•	Search for food places along a custom-defined route.
	•	Get real-time recommendations for restaurants or cafes that are close to their path.
	•	Use Google’s Autocomplete API for easy destination searches and Leaflet.js for interactive maps.

⸻

Features
	•	Geolocation Support: Fetches the user’s current location using the browser’s geolocation API.
	•	Dynamic Search: Uses Google Places API to search for food destinations along a travel route with autocomplete support.
	•	Polyline Path: Optimizes the user’s travel route by drawing polylines using Google’s Directions API to show the best route with food places on the way.
	•	Custom Map UI: Interactive map using Leaflet.js, complete with custom markers and popups for food places, user location, and destination.
	•	Responsive Design: Fully responsive design that works seamlessly on desktops, tablets, and smartphones.

⸻

Technologies Used
	•	React: For building the dynamic, component-based UI.
	•	Leaflet.js: Open-source JavaScript library for mobile-friendly interactive maps.
	•	Google Maps API: Provides geolocation services, autocomplete destination search, and route planning features.
	•	Google Places API: Fetches data for nearby food places, such as restaurants, cafes, and bars.
	•	React Router: Enables navigation between different views such as the map, settings, and details pages.
	•	SCSS: For custom styling, ensuring a responsive and visually appealing user interface.

⸻

Getting Started

Prerequisites

To run Mapetite locally, you’ll need:
	•	Node.js: Version 14.x or later.
	•	npm or yarn for managing dependencies.
	•	Google Maps API Key: You’ll need to create a project in the Google Cloud Console and enable the Maps JavaScript API, Places API, and Directions API to use the map and autocomplete features.

⸻

Installation

Follow these steps to get a local copy of the project up and running:

1. Clone the repository:

git clone https://github.com/your-username/mappetite.git

2. Install dependencies:

If you’re using npm:

cd mappetite
npm install

Or if you’re using yarn:

cd mappetite
yarn install

3. Set up your Google Maps API Key:

Create a .env file in the root of the project and add your Google Maps API Key like this:

REACT_APP_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

Make sure to replace your_google_maps_api_key_here with your actual API key.

⸻

Usage

1. Run the development server:

After installation, start the project locally by running:

npm start

or

yarn start

This will start the development server and open the app in your browser at http://localhost:3000.

⸻

Screenshots

Here are some screenshots of the app:

Example of the interactive map showing food spots along the route.

Real-time autocomplete search bar for destinations.

⸻

Contributing

We welcome contributions to Mapetite! Here’s how you can help:
	1.	Fork the repository.
	2.	Create your feature branch (git checkout -b feature-name).
	3.	Commit your changes (git commit -m 'Add new feature').
	4.	Push to your branch (git push origin feature-name).
	5.	Open a pull request.

Please make sure to follow the coding style used in the project.

⸻

License

This project is licensed under the MIT License – see the LICENSE file for details.

⸻
