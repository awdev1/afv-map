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
        this.setInRangeList();
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
    const tabButtons = document.querySelectorAll(".tab-btn");
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = (btn as HTMLElement).getAttribute("data-tab");
        if (targetTab) {
          this.switchTab(targetTab);
        }
      });
    });

    void this.reloadMapData();
    setInterval(() => {
      void this.reloadMapData();
    }, 15000);
  }

  async reloadMapData() {
    const response = await fetch("https://afv-map-api.vercel.app/api/map-data");
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
    this.setInRangeList();
  }

  upsertClient(clientData: ClientData) {
    const { callsign } = clientData;

    let client = this.clients[callsign];
    if (!client) {
      client = instantiateClient(clientData);
      client.setClickCallback((clickedCallsign: string) => {
        this.clientClicked(clickedCallsign);
      });
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
    if (!client) {
      console.error("Client not found:", callsign);
      return;
    }
    console.log("Clicked client:", callsign);
    let zoom = this.map.getZoom();
    if (zoom < 3) zoom = 3;
    this.map.setView(client.position(), zoom);
    
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const searchInput = document.getElementById("ring-search")! as HTMLInputElement;
    if (searchInput) {
      searchInput.value = callsign;
      this.ringSearchTerm = callsign.toLowerCase();
      this.filterRangeRings();
      this.setInRangeList();
    } else {
      console.error("Search input not found");
    }
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

  switchTab(tabName: string) {
    const tabButtons = document.querySelectorAll(".tab-btn");
    tabButtons.forEach((btn) => {
      if ((btn as HTMLElement).getAttribute("data-tab") === tabName) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    const tabContents = document.querySelectorAll(".tab-content");
    tabContents.forEach((content) => {
      if ((content as HTMLElement).getAttribute("data-tab-content") === tabName) {
        content.classList.add("active");
      } else {
        content.classList.remove("active");
      }
    });
  }

  setInRangeList() {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const el = document.getElementById("in-range-list")!;

    let pilots = Object.values(this.clients).filter(
      (c) => c.clientData.type === "PILOT"
    );

    if (this.ringSearchTerm) {
      pilots = pilots.filter((pilot) =>
        pilot.callsign().toLowerCase().includes(this.ringSearchTerm)
      );
    }

    if (pilots.length === 0) {
      el.innerHTML = '<div class="no-aircraft">No pilots online</div>';
      return;
    }

    const rangeGroups = pilots.map((pilot) => {
      const pilotsInRange = this.findPilotsInRange(pilot);
      return { pilot, pilotsInRange };
    });

    el.innerHTML = rangeGroups
      .map(({ pilot, pilotsInRange }) => {
        const callsign = pilot.callsign();
        const count = pilotsInRange.length;
        
        let aircraftHtml = "";
        if (count === 0) {
          aircraftHtml = '<div class="no-aircraft">No pilots in range</div>';
        } else {
          aircraftHtml = pilotsInRange
            .map(
              (otherPilot) =>
                `<div class="aircraft-item" data-callsign="${otherPilot.callsign()}">
                  <strong>${otherPilot.callsign()}</strong> - ${otherPilot.clientData.altitude}ft
                </div>`
            )
            .join("");
        }

        return `
          <div class="range-group">
            <div class="range-group-header" data-callsign="${callsign}">
              <div>
                <strong>${callsign}</strong> - ${pilot.clientData.altitude}ft
              </div>
              <div style="color: var(--text-secondary); font-size: 0.85rem;">
                ${count} pilots
              </div>
            </div>
            <div class="range-group-aircraft">
              ${aircraftHtml}
            </div>
          </div>
        `;
      })
      .join("");

    const headers = el.querySelectorAll(".range-group-header");
    headers.forEach((header) => {
      header.addEventListener("click", () => {
        const callsign = (header as HTMLElement).getAttribute("data-callsign");
        if (callsign) {
          this.clientClicked(callsign);
        }
      });
    });

    const aircraftItems = el.querySelectorAll(".aircraft-item");
    aircraftItems.forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const callsign = (item as HTMLElement).getAttribute("data-callsign");
        if (callsign) {
          this.clientClicked(callsign);
        }
      });
    });
  }

  findPilotsInRange(pilot: Client) {
    const otherPilots = Object.values(this.clients).filter(
      (c) => c.clientData.type === "PILOT" && c.callsign() !== pilot.callsign()
    );

    const pilotsInRange: Client[] = [];

    for (const otherPilot of otherPilots) {
      const otherPilotPos = otherPilot.position() as { lat: number; lng: number };
      
      for (const ring of Object.values(pilot.rangeRings)) {
        const ringCenter = ring.getLatLng();
        const ringRadius = ring.getRadius();
        const distance = this.map.distance(ringCenter, otherPilotPos);
        
        if (distance <= ringRadius) {
          pilotsInRange.push(otherPilot);
          break; 
        }
      }
    }

    return pilotsInRange.sort((a, b) => {
      if (a.callsign() < b.callsign()) return -1;
      if (a.callsign() > b.callsign()) return 1;
      return 0;
    });
  }
}
