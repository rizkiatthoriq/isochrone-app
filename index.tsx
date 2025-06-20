/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// We're using Leaflet via CDN, so declare L to satisfy TypeScript
declare namespace L {
    type Map = any; // Consider more specific types if needed: { on: (type: string, fn: (event: any) => void, context?: any) => Map, ... }
    type Layer = any;
    type LatLngLiteral = { lat: number; lng: number };
    type LatLng = { lat: number; lng: number; alt?: number; equals: (otherLatLng: LatLng, maxMargin?: number) => boolean; toString: () => string; distanceTo: (otherLatLng: LatLng) => number; clone: () => LatLng; };
    type Marker = Layer;
    type CircleMarker = Layer;
    type Polygon = Layer; 
    type LatLngBounds = any; // Represents a rectangular geographical area. Actual type has methods like extend, getSouthWest, getNorthEast, isValid.

    interface IconOptions {
        iconUrl?: string;
        iconRetinaUrl?: string;
        iconSize?: [number, number];
        iconAnchor?: [number, number];
        popupAnchor?: [number, number];
        shadowUrl?: string;
        shadowRetinaUrl?: string;
        shadowSize?: [number, number];
        shadowAnchor?: [number, number];
    }
    class Icon {
        constructor(options: IconOptions);
        static Default: { imagePath?: string } & (new (options?: Partial<IconOptions>) => Icon);
    }

    // Simplified LeafletMouseEvent for map clicks
    interface LeafletMouseEvent {
        latlng: LatLng;
    }

    function map(id: string | HTMLElement, options?: any): Map;
    function tileLayer(urlTemplate: string, options?: any): Layer;
    function circle(latlng: LatLng | LatLngLiteral, options?: any): Layer;
    function marker(latlng: LatLng | LatLngLiteral, options?: { icon?: Icon | undefined } & any): Marker;
    function circleMarker(latlng: LatLng | LatLngLiteral, options?: any): CircleMarker;
    function polygon(latlngs: (LatLng | LatLngLiteral)[] | (LatLng | LatLngLiteral)[][] | (LatLng | LatLngLiteral)[][][], options?: any): Polygon;
    function latLng(latitude: number, longitude: number, altitude?: number): LatLng; 
    function latLngBounds(corner1: LatLng | LatLngLiteral, corner2: LatLng | LatLngLiteral): LatLngBounds;
    function latLngBounds(latlngs: (LatLng | LatLngLiteral)[]): LatLngBounds;
}


class IsochroneApp {
    private map: L.Map | null = null;
    private locationInput: HTMLInputElement;
    private typeDistanceRadio: HTMLInputElement;
    private typeTimeRadio: HTMLInputElement;
    private distanceControls: HTMLElement;
    private distanceInput: HTMLInputElement;
    private timeControls: HTMLElement;
    private timeInput: HTMLInputElement;
    private numBandsInput: HTMLInputElement;
    private generateBtn: HTMLButtonElement;
    private loadingMessage: HTMLElement;
    private infoMessage: HTMLElement;
    private legendItemsContainer: HTMLElement;

    private currentIsochroneLayers: L.Layer[] = [];
    private centerMarker: L.Marker | null = null;
    private clickedMapLatLng: L.LatLng | null = null; 

    private isoPalette: string[] = ['#66BB6A', '#FFEE58', '#FFA726', '#EF5350', '#D81B60', '#B71C1C', '#880E4F', '#4A148C', '#311B92', '#1A237E'];

    private knownLocations: { [key: string]: L.LatLngLiteral & { zoom?: number } } = {
        "eiffel tower": { lat: 48.8584, lng: 2.2945, zoom: 14 },
        "statue of liberty": { lat: 40.6892, lng: -74.0445, zoom: 15 },
        "brandenburg gate": { lat: 52.5163, lng: 13.3777, zoom: 15 },
        "colosseum": { lat: 41.8902, lng: 12.4922, zoom: 15 },
        "sydney opera house": { lat: -33.8568, lng: 151.2153, zoom: 16 }
    };


    constructor() {
        this.locationInput = document.getElementById('location') as HTMLInputElement;
        this.typeDistanceRadio = document.getElementById('type-distance') as HTMLInputElement;
        this.typeTimeRadio = document.getElementById('type-time') as HTMLInputElement;
        this.distanceControls = document.getElementById('distance-controls') as HTMLElement;
        this.distanceInput = document.getElementById('distance-value') as HTMLInputElement;
        this.timeControls = document.getElementById('time-controls') as HTMLElement;
        this.timeInput = document.getElementById('time-value') as HTMLInputElement;
        this.numBandsInput = document.getElementById('num-bands') as HTMLInputElement;
        this.generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
        this.loadingMessage = document.getElementById('loading-message') as HTMLElement;
        this.infoMessage = document.getElementById('info-message') as HTMLElement;
        this.legendItemsContainer = document.getElementById('legend-items') as HTMLElement;
        
        this.initializeApp();
    }

    private initializeApp(): void {
        this.initMap();
        this.attachEventListeners();
        this.updateFormControls(); 
    }

    private initMap(): void {
        this.map = L.map('map').setView([48.8566, 2.3522], 6); // Default to Paris

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(this.map!);

        this.map!.on('click', this.handleMapClick.bind(this));
    }

    private attachEventListeners(): void {
        this.typeDistanceRadio.addEventListener('change', this.updateFormControls.bind(this));
        this.typeTimeRadio.addEventListener('change', this.updateFormControls.bind(this));
        this.generateBtn.addEventListener('click', this.handleGenerateIsochrone.bind(this));
    }

    private updateFormControls(): void {
        if (this.typeDistanceRadio.checked) {
            this.distanceControls.style.display = 'flex';
            this.timeControls.style.display = 'none';
        } else {
            this.distanceControls.style.display = 'none';
            this.timeControls.style.display = 'flex';
        }
    }

    private clearMapFeatures(): void {
        if (this.centerMarker) {
            this.map?.removeLayer(this.centerMarker);
            this.centerMarker = null;
        }
        this.currentIsochroneLayers.forEach(layer => this.map?.removeLayer(layer));
        this.currentIsochroneLayers = [];
        this.legendItemsContainer.innerHTML = '';
    }

    private handleMapClick(e: L.LeafletMouseEvent): void {
        if (!this.map) return;

        this.clickedMapLatLng = e.latlng;
        this.locationInput.value = ''; // Clear text input as click takes precedence

        this.clearMapFeatures(); // Clear previously generated features and their marker

        // Add a new, temporary marker for the click.
        // This marker will be removed by clearMapFeatures() when "Generate Isochrone" is next clicked.
        this.centerMarker = L.marker(this.clickedMapLatLng)
            .addTo(this.map)
            .bindPopup("New center selected. Press 'Generate'.")
            .openPopup();

        this.showInfoMessage("New center selected on map. Adjust parameters and click 'Generate Isochrone'.", 'info');
        console.log("Map clicked. New potential center:", this.clickedMapLatLng);
    }

    private calculateBaseRadius(value: number, isDistanceType: boolean): number {
        if (isDistanceType) {
            return value * 1000; 
        } else {
            // Assuming average speed for time-based isochrones (e.g., 200m per minute ~ 12km/h)
            // This is a very rough estimate for simulation.
            return value * 200; 
        }
    }
    
    private generateIrregularPolygonPoints(center: L.LatLng, baseRadius: number, numVertices: number = 16, irregularityFactor: number = 0.35): L.LatLng[] {
        const points: L.LatLng[] = [];
        const angleStep = (2 * Math.PI) / numVertices;

        for (let i = 0; i < numVertices; i++) {
            const angle = i * angleStep;
            const randomFactor = 1 + (Math.random() - 0.5) * 2 * irregularityFactor;
            const perturbedRadius = baseRadius * randomFactor;

            // Convert meters to degrees (approximation)
            const latOffsetMeters = perturbedRadius * Math.sin(angle);
            const lngOffsetMeters = perturbedRadius * Math.cos(angle);

            const latOffsetDegrees = latOffsetMeters / 111111; // meters per degree latitude
            const lngOffsetDegrees = lngOffsetMeters / (111111 * Math.cos(center.lat * Math.PI / 180)); // meters per degree longitude
            
            points.push(L.latLng(center.lat + latOffsetDegrees, center.lng + lngOffsetDegrees));
        }
        return points;
    }


    private async handleGenerateIsochrone(): Promise<void> {
        if (!this.map) return;
        console.log("Starting isochrone generation...");

        const rawLocationName = this.locationInput.value.trim();
        const locationNameKey = rawLocationName.toLowerCase();
        const isDistanceType = this.typeDistanceRadio.checked;
        const totalValue = parseFloat(isDistanceType ? this.distanceInput.value : this.timeInput.value);
        const numBands = parseInt(this.numBandsInput.value, 10);

        if (isNaN(totalValue) || totalValue <= 0) {
            this.showInfoMessage(`Please enter a valid positive total ${isDistanceType ? 'distance' : 'time'}.`, 'error');
            return;
        }
        if (isNaN(numBands) || numBands <= 0 || numBands > 10) { 
            this.showInfoMessage('Number of bands must be between 1 and 10 (due to color palette).', 'error');
            return;
        }

        this.loadingMessage.style.display = 'block';
        this.infoMessage.style.display = 'none';
        this.generateBtn.disabled = true;

        this.clearMapFeatures(); // Clear any existing markers, layers, and legend
        
        await new Promise(resolve => setTimeout(resolve, 100)); // Short delay for UX

        let centerLatLng: L.LatLng;
        let infoMsg: string;
        let locationLabel: string;
        let targetZoomForFitBounds = 14; // Default zoom for fitBounds

        const knownLocation = this.knownLocations[locationNameKey];

        if (rawLocationName && knownLocation) {
            centerLatLng = L.latLng(knownLocation.lat, knownLocation.lng);
            targetZoomForFitBounds = knownLocation.zoom || 14;
            this.map.setView(centerLatLng, targetZoomForFitBounds);
            infoMsg = `Showing isochrones for "${rawLocationName}". This is a visual approximation.`;
            locationLabel = rawLocationName;
            this.clickedMapLatLng = null; // Text input takes precedence
            console.log(`Using known location: "${rawLocationName}". Coords: ${centerLatLng.lat}, ${centerLatLng.lng}. Zoom: ${targetZoomForFitBounds}`);
        } else if (this.clickedMapLatLng) {
            centerLatLng = this.clickedMapLatLng;
            // No need to setView here, map is already where user clicked or panned.
            // Retain current map zoom or a sensible default if too zoomed out.
            targetZoomForFitBounds = this.map.getZoom() < 10 ? 13 : this.map.getZoom(); 
            infoMsg = `Generating isochrones around the point selected on the map. This is a visual approximation.`;
            locationLabel = "Clicked Point";
            console.log(`Using map-clicked location: ${centerLatLng.lat}, ${centerLatLng.lng}`);
        } else {
            centerLatLng = this.map.getCenter();
            targetZoomForFitBounds = this.map.getZoom() < 10 ? 13 : this.map.getZoom();
            if (rawLocationName) { // Typed something, but not known
                infoMsg = `Location "${rawLocationName}" not recognized. Generating around current map center. Pan/zoom map or click to select a point.`;
            } else { // Nothing typed, no click
                infoMsg = `Generating isochrones around the current map center. Pan/zoom map or click to select a point.`;
            }
            locationLabel = "Current Map Center";
            this.clickedMapLatLng = null; // Using map center, so no active click
            console.log(`No known location or click. Using current map center: ${centerLatLng.lat}, ${centerLatLng.lng}`);
        }
        
        this.centerMarker = L.marker(centerLatLng).addTo(this.map);
        this.centerMarker.bindPopup(`Center: ${locationLabel}`).openPopup();

        const increment = totalValue / numBands;
        let cumulativeBounds: L.LatLngBounds | null = null;

        for (let i = numBands - 1; i >= 0; i--) { // Draw from largest to smallest for layering effect
            const bandValueEnd = (i + 1) * increment;
            const baseRadiusMeters = this.calculateBaseRadius(bandValueEnd, isDistanceType);
            const color = this.isoPalette[i % this.isoPalette.length];

            const polygonPoints = this.generateIrregularPolygonPoints(centerLatLng, baseRadiusMeters);
            
            const polygonLayer = L.polygon(polygonPoints, {
                color: color,      
                fillColor: color,  
                fillOpacity: 0.35,
                weight: 1.5 
            }).addTo(this.map);
            this.currentIsochroneLayers.push(polygonLayer);

            const polygonBounds = polygonLayer.getBounds();
             if (polygonBounds && typeof polygonBounds.extend === 'function' && typeof polygonBounds.isValid === 'function' && polygonBounds.isValid()) {
                if (!cumulativeBounds) {
                    cumulativeBounds = L.latLngBounds(polygonBounds.getSouthWest(), polygonBounds.getNorthEast());
                } else {
                    cumulativeBounds.extend(polygonBounds);
                }
            }
        }
        
        this.updateLegend(totalValue, numBands, isDistanceType);

        if (this.currentIsochroneLayers.length > 0 && cumulativeBounds && cumulativeBounds.isValid()) {
             console.log("Fitting map to cumulative bounds. Max zoom:", targetZoomForFitBounds);
             this.map.fitBounds(cumulativeBounds, { padding: [50, 50], maxZoom: targetZoomForFitBounds });
        } else if (this.centerMarker) { 
            console.log("No valid polygons/bounds, setting view to center marker at zoom:", targetZoomForFitBounds);
            this.map.setView(centerLatLng, targetZoomForFitBounds);
        }

        this.showInfoMessage(infoMsg, 'info');
        this.loadingMessage.style.display = 'none';
        this.generateBtn.disabled = false;
        console.log("Isochrone generation complete.");
    }

    private updateLegend(totalValue: number, numBands: number, isDistanceType: boolean): void {
        this.legendItemsContainer.innerHTML = ''; 
        const increment = totalValue / numBands;
        const unit = isDistanceType ? 'km' : 'min';

        // Generate legend from smallest to largest range (matches visual layers better)
        for (let i = 0; i < numBands; i++) {
            const rangeStart = i * increment;
            const rangeEnd = (i + 1) * increment;
            // Palette is ordered green (near) to red (far). 
            // If polygons are drawn largest (reddest) first, then legend should match that order.
            // Or, if palette is used [0] for closest, [n] for furthest, then index legend same way.
            // Current polygon drawing loop: `i` goes from `numBands-1` down to `0`.
            // isoPalette[i % length] means largest radius uses `isoPalette[ (numBands-1) % length ]`.
            // To make legend match visual (green = closest band displayed on top)
            // legend item `i=0` (0-increment) should use `isoPalette[0]`
            const color = this.isoPalette[i % this.isoPalette.length]; 

            const legendItem = document.createElement('div');
            legendItem.className = 'legend-item';

            const colorSwatch = document.createElement('div');
            colorSwatch.className = 'legend-color-swatch';
            colorSwatch.style.backgroundColor = color;

            const label = document.createElement('span');
            const formattedStart = rangeStart % 1 === 0 ? rangeStart.toFixed(0) : rangeStart.toFixed(1);
            const formattedEnd = rangeEnd % 1 === 0 ? rangeEnd.toFixed(0) : rangeEnd.toFixed(1);
            label.textContent = `${formattedStart} - ${formattedEnd} ${unit}`;
            
            legendItem.appendChild(colorSwatch);
            legendItem.appendChild(label);
            this.legendItemsContainer.appendChild(legendItem);
        }
    }


    private showInfoMessage(message: string, type: 'info' | 'error' = 'info'): void {
        this.infoMessage.textContent = message;
        this.infoMessage.className = `message message-${type}`; 
        this.infoMessage.style.color = type === 'error' ? '#a94442' : '#31708f';
        this.infoMessage.style.backgroundColor = type === 'error' ? '#f2dede' : '#d9edf7';
        this.infoMessage.style.borderColor = type === 'error' ? '#ebccd1' : '#bce8f1';
        this.infoMessage.style.display = 'block';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new IsochroneApp();
});