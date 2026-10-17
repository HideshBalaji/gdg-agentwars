"""Version 1 contracts shared with the UI and data owner. No LLM-derived safety rules."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")]
AgentName = Literal[
    "dispatcher", "intake", "route_risk", "negotiator", "comms", "validator", "watchdog", "critic"
]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Location(Contract):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    label: str = ""


class Reading(Contract):
    at: AwareDatetime
    temp_c: float


class Truck(Contract):
    id: Identifier
    carrier_id: Identifier
    reefer: bool
    capacity_kg: float = Field(gt=0)
    available_capacity_kg: float = Field(ge=0)
    location: Location
    status: Literal["available", "assigned", "broken", "unavailable"] = "available"
    driver_id: Identifier | None = None
    pricing: dict | None = None
    driver_hours_left: float = Field(ge=0)
    temperature_history: list[Reading] = Field(default_factory=list)

    @model_validator(mode="after")
    def capacity_valid(self):
        if self.available_capacity_kg > self.capacity_kg:
            raise ValueError("Available capacity cannot exceed total capacity")
        return self


class Shipment(Contract):
    id: Identifier
    truck_id: Identifier
    cargo: str
    weight_kg: float = Field(gt=0)
    temp_min_c: float | None
    temp_max_c: float | None
    safe_minutes_out_of_range: float | None = Field(gt=0)
    destination: Location
    warehouse_id: Identifier
    deadline: AwareDatetime
    cold_restore_deadline: AwareDatetime | None = None
    receiving_minutes: float = Field(default=0, ge=0)
    customer_id: str | None = None
    cargo_profile_id: str | None = None
    transfer_minutes: float = Field(default=20, ge=0)

    @model_validator(mode="after")
    def temperature_valid(self):
        if (self.temp_min_c is None) != (self.temp_max_c is None):
            raise ValueError("Both temperature bounds must be supplied together")
        if self.temp_min_c is not None and self.temp_min_c >= self.temp_max_c:
            raise ValueError("Temperature minimum must be below maximum")
        return self


class Carrier(Contract):
    id: Identifier
    name: str
    cost_per_km: float | None = Field(default=None, gt=0)
    reliability: float = Field(ge=0, le=1)
    region: str = "demo"


class DockWindow(Contract):
    id: Identifier
    start: AwareDatetime
    end: AwareDatetime
    reserved_for: Identifier | None = None


class Warehouse(Contract):
    id: Identifier
    location: Location
    free_capacity_kg: float = Field(ge=0)
    dock_slots: list[AwareDatetime]
    dock_windows: list[DockWindow] = Field(default_factory=list)


class Seed(Contract):
    trucks: list[Truck] = Field(max_length=1000)
    shipments: list[Shipment] = Field(max_length=1000)
    carriers: list[Carrier] = Field(max_length=1000)
    warehouses: list[Warehouse] = Field(max_length=1000)

    @model_validator(mode="after")
    def references_valid(self):
        groups = (self.trucks, self.shipments, self.carriers, self.warehouses)
        for group in groups:
            if len({item.id for item in group}) != len(group):
                raise ValueError("Duplicate IDs in seed group")
        trucks = {t.id for t in self.trucks}
        carriers = {c.id for c in self.carriers}
        warehouses = {w.id for w in self.warehouses}
        if any(t.carrier_id not in carriers for t in self.trucks):
            raise ValueError("Truck refers to unknown carrier")
        if any(
            s.truck_id not in trucks or s.warehouse_id not in warehouses for s in self.shipments
        ):
            raise ValueError("Shipment refers to unknown truck or warehouse")
        return self


class IncidentCreate(Contract):
    shipment_id: Identifier
    type: Literal["truck_breakdown", "fridge_failure", "customer_unavailable", "damaged_delivery"]
    description: str = Field(min_length=1, max_length=4000)
    evidence_ids: list[Identifier] = Field(default_factory=list, max_length=10)


class Candidate(Contract):
    truck_id: Identifier
    carrier_id: Identifier
    travel_minutes: float
    distance_km: float
    arrival: AwareDatetime
    dock_time: AwareDatetime
    cost: float
    slack_minutes: float
    route_source: str
    cold_restore_at: AwareDatetime | None = None
    duty_minutes: float | None = None
    dock_slot_id: str | None = None
    currency: str = "demo_units"


class Plan(Contract):
    id: Identifier
    created_at: AwareDatetime
    deadline: AwareDatetime
    candidates: list[Candidate]
    chosen: Candidate
    reason: str
    simulated: bool


class Incident(IncidentCreate):
    id: Identifier
    status: Literal["open", "planned", "executing", "resolved", "blocked"] = "open"
    created_at: AwareDatetime
    plan: Plan | None = None
    actions: dict = Field(default_factory=dict)
    outcome: str | None = None


class Feedback(Contract):
    rating: Literal["up", "down"]
    reason: str = Field(min_length=1, max_length=1000)
    prefer_cheaper_when_slack: bool = False


class Message(Contract):
    text: str = Field(min_length=1, max_length=8000)
    evidence_ids: list[Identifier] = Field(default_factory=list, max_length=10)
    target_agent: AgentName | None = None


class ConversationCreate(Contract):
    incident_id: Identifier


class Conversation(Contract):
    id: Identifier
    incident_id: Identifier
    active_agent: AgentName
    messages: list[dict]


class ChatReply(Contract):
    conversation_id: Identifier
    active_agent: AgentName
    replies: list[dict]
    simulated: bool


class Evidence(Contract):
    id: Identifier
    mime_type: str
    size: int
    pii_screen: str | None = None


class Event(Contract):
    id: int
    incident_id: str
    type: str
    at: datetime
    data: dict
