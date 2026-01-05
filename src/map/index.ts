import L from "leaflet";

import Client from "./clients/client.ts";
import { instantiateClient } from "./clients/factory.ts";
import { ClientData } from "./types.ts";

// Map Layers
const basic = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
    minZoom: 0,
  }
);

const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
});

const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: '&copy; <a href="http://www.esri.com/">Esri</a>',
  }
);

const dark = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
    minZoom: 0,
  }
);

export class TransceiverMap {
  private readonly map: L.Map;
  private clients: Record<string, Client> = {};
  private filteredCallsigns: string[];
  private ringSearchTerm = "";
  private isInitialLoad = true;

  constructor(element: string | HTMLElement) {
    this.map = L.map(element, {
      center: [0, 0],
      zoom: 2,
    });

    const queryArgs = new URLSearchParams(window.location.search);
    this.filteredCallsigns = queryArgs.getAll("callsign");

    const maps = {
      Dark: dark,
      Basic: basic,
      Streets: streets,
      Satellite: satellite,
    };
    dark.addTo(this.map);
    L.control.layers(maps).addTo(this.map);

    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    document
      .getElementById("ring-search")!
      .addEventListener("input", (e) => {
        this.ringSearchTerm = (e.target as HTMLInputElement).value.toLowerCase();
        this.filterRangeRings();
      });
    document
      .getElementById("toggle-pilot-ranges")!
      .addEventListener("click", () =>
        this.toggleMapClass("hide-pilot-ranges")
      );
    document
      .getElementById("toggle-atc-ranges")!
      .addEventListener("click", () => this.toggleMapClass("hide-atc-ranges"));
    document
      .getElementById("toggle-other-ranges")!
      .addEventListener("click", () =>
        this.toggleMapClass("hide-other-ranges")
      );
    /* eslint-enable @typescript-eslint/no-non-null-assertion */

    void this.reloadMapData();
    setInterval(() => {
      void this.reloadMapData();
    }, 15000);
  }

  async reloadMapData() {
    const response = await fetch("https://corsproxy.io/?url=https://afv-map.vatsim.net/map-data");
    const data = (await response.json()) as { clients: ClientData[] };

    for (const client of data.clients) {
      if (
        this.filteredCallsigns.length > 0 &&
        !this.filteredCallsigns.includes(client.callsign)
      ) {
        continue;
      }

      this.upsertClient(client);
    }

    this.removeClients(this.findDisconnectedClients(data.clients));

    this.setClientsOnline(Object.keys(this.clients).length);
    this.setClientList();
  }

  upsertClient(clientData: ClientData) {
    const { callsign } = clientData;

    let client = this.clients[callsign];
    if (!client) {
      client = instantiateClient(clientData);
    }

    client.update(this.map, clientData);

    this.clients[callsign] = client;
  }

  findDisconnectedClients(clientsData: ClientData[]) {
    const oldCallsigns = Object.keys(this.clients);
    const newCallsigns = clientsData.map((c: ClientData) => c.callsign);

    return oldCallsigns.filter((c) => !newCallsigns.includes(c));
  }

  removeClients(callsigns: string[]) {
    for (const callsign of callsigns) {
      this.removeClient(callsign);
    }
  }

  removeClient(callsign: string) {
    this.clients[callsign].destroy();
    delete this.clients[callsign];
  }

  setClientsOnline(num: number) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const el = document.getElementById("online-count")!;
    el.innerText = `${num} clients connected`;
  }

  setClientList() {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const el = document.getElementById("client-list")!;

    const clients = Object.values(this.clients).sort((a, b) => {
      if (a.clientData.callsign < b.clientData.callsign) return -1;
      if (a.clientData.callsign > b.clientData.callsign) return 1;
      return 0;
    });

    el.innerHTML = clients
      .map(
        (c: Client, index: number) => {
          const animationClass = this.isInitialLoad ? 'animate-in' : '';
          const animationStyle = this.isInitialLoad
            ? `style="animation-delay: ${index * 0.05}s"`
            : '';
          return `<div class="text-white clientEntry ${animationClass}" id='${c.callsign()}' ${animationStyle}>${c.getListText()}</div>`;
        }
      )
      .join("");

    this.isInitialLoad = false;

    const clientEls = document.getElementsByClassName("clientEntry");
    for (const i of clientEls) {
      i.addEventListener("click", () => {
        this.clientClicked(i.id);
      });
    }
  }

  clientClicked(callsign: string) {
    const client = this.clients[callsign];
    console.log(client);
    let zoom = this.map.getZoom();
    if (zoom < 3) zoom = 3;
    this.map.setView(client.position(), zoom);
  }

  toggleMapClass(className: string) {
    const el = this.map.getContainer();
    el.classList.toggle(className);
  }

  filterRangeRings() {
    Object.values(this.clients).forEach((client: Client) => {
      const callsign = client.callsign().toLowerCase();
      const matches = callsign.includes(this.ringSearchTerm);
      
      Object.values(client.rangeRings).forEach((ring: L.Circle) => {
        if (matches || this.ringSearchTerm === "") {
          ring.addTo(this.map);
        } else {
          ring.remove();
        }
      });
    });
  }
}
