const API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImFjMzQwMTdiMzBjNDRjYTZhNjZhZmM0OWExYmEzNzdiIiwiaCI6Im11cm11cjY0In0="; // Replace with your OpenRouteService API Key

const map = L.map('map').setView([19.076, 72.8777], 13); // Mumbai default

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

document.getElementById('routeBtn').addEventListener('click', async () => {
    const start = document.getElementById('start').value.split(',').map(Number);
    const end = document.getElementById('end').value.split(',').map(Number);

    if (start.length !== 2 || end.length !== 2) {
        alert("Please enter coordinates as lat,lng");
        return;
    }

    const url = `https://api.openrouteservice.org/v2/directions/foot-walking?api_key=${API_KEY}&start=${start[1]},${start[0]}&end=${end[1]},${end[0]}`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();

        const coords = data.features[0].geometry.coordinates.map(c => [c[1], c[0]]);
        
        L.polyline(coords, { color: 'blue', weight: 4 }).addTo(map);
        map.fitBounds(L.polyline(coords).getBounds());

    } catch (err) {
        console.error(err);
        alert("Error fetching route");
    }
});
