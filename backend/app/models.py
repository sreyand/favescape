from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,100}$")]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Score = Annotated[int, Field(ge=1, le=5, strict=True)]
Coordinate = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Point(StrictModel):
    x: Coordinate
    y: Coordinate


class Mood(StrictModel):
    id: Identifier
    label: Label
    color: Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
    x: Coordinate
    y: Coordinate


class Features(StrictModel):
    tempo: Annotated[float, Field(ge=0, le=500, allow_inf_nan=False)] | None = None
    brightness: Annotated[float, Field(ge=0, le=100000, allow_inf_nan=False)] | None = None
    rms: Annotated[float, Field(ge=0, le=10, allow_inf_nan=False)] | None = None


class Track(StrictModel):
    id: Identifier
    title: Label
    artist: Label
    album: str = Field(default="", max_length=500)
    genres: list[Label] = Field(default_factory=list, max_length=30)
    duration: float = Field(ge=0, le=86400, allow_inf_nan=False)
    artwork: str | None = Field(default=None, max_length=500)
    color: Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")] = "#164DBB"
    audioUrl: str | None = None
    isDemo: bool = False
    addedAt: str
    enjoyment: Score | None = None
    moodRatings: dict[Identifier, Score] = Field(default_factory=dict)
    moodNotes: dict[Identifier, str] = Field(default_factory=dict)
    analysisStatus: Literal["pending", "running", "ready", "failed"] = "pending"
    analysisError: str | None = None
    features: Features | None = None
    position: Point | None = None


class TrackPatch(StrictModel):
    title: Label | None = None
    artist: Label | None = None
    genres: list[Label] | None = Field(default=None, max_length=30)
    enjoyment: Score | None = None


class MoodRating(StrictModel):
    moodId: Identifier
    score: Score
    note: str = Field(default="", max_length=2000)


class MoodCreate(StrictModel):
    label: Label
    color: Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")] | None = None


class GroupCreate(StrictModel):
    name: Label
    trackIds: list[Identifier] = Field(max_length=10000)


class Group(GroupCreate):
    id: Identifier


class ConnectionCreate(StrictModel):
    sourceId: Identifier
    targetId: Identifier
    reason: str = Field(default="", max_length=2000)


class Connection(ConnectionCreate):
    id: Identifier
    origin: Literal["user", "model"] = "user"


class PositionUpdate(Point):
    trackId: Identifier


class Positions(StrictModel):
    positions: list[PositionUpdate] = Field(max_length=10000)
    revision: int = Field(ge=0)


class Playback(StrictModel):
    trackIds: list[Identifier] = Field(default_factory=list, max_length=10000)
    currentTrackId: Identifier | None = None
    position: float = Field(default=0, ge=0, le=86400, allow_inf_nan=False)
    volume: float = Field(default=0.7, ge=0, le=1, allow_inf_nan=False)
    shuffle: bool = False
    repeat: bool = False


class TasteRequest(StrictModel):
    moodId: Identifier
    durationMinutes: float = Field(ge=0.25, le=240, allow_inf_nan=False)
    seed: int | None = Field(default=None, ge=0, le=2147483647)


class TasteSession(StrictModel):
    id: Identifier
    moodId: Identifier
    trackIds: list[Identifier] = Field(max_length=10000)
    requestedDuration: float = Field(ge=0, le=86400, allow_inf_nan=False)
    actualDuration: float = Field(ge=0, le=864000000, allow_inf_nan=False)
    reasons: dict[Identifier, str]
    message: str
    seed: int
    method: str


class SessionPatch(StrictModel):
    trackIds: list[Identifier] = Field(max_length=10000)


class ExportTrack(Track):
    sourceHash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")] | None = None


class RatingEvent(StrictModel):
    id: Identifier
    trackId: Identifier
    moodId: Identifier
    score: Score | None
    note: str = Field(default="", max_length=2000)
    createdAt: str


class FeedbackCreate(StrictModel):
    trackId: Identifier
    moodId: Identifier
    sessionId: Identifier | None = None
    value: Literal["great_fit", "wrong_mood"]


class FeedbackEvent(FeedbackCreate):
    id: Identifier
    createdAt: str


class EnjoymentEvent(StrictModel):
    id: Identifier
    trackId: Identifier
    score: Score | None
    createdAt: str


class MapDocument(StrictModel):
    schemaVersion: Literal[1]
    exportedAt: str
    tracks: list[ExportTrack] = Field(max_length=10000)
    moods: list[Mood] = Field(max_length=200)
    connections: list[Connection] = Field(default_factory=list, max_length=50000)
    groups: list[Group] = Field(default_factory=list, max_length=1000)
    sessions: list[TasteSession] = Field(default_factory=list, max_length=1000)
    ratingHistory: list[RatingEvent] = Field(default_factory=list, max_length=100000)
    feedback: list[FeedbackEvent] = Field(default_factory=list, max_length=100000)
    enjoymentHistory: list[EnjoymentEvent] = Field(default_factory=list, max_length=100000)
    layoutRevision: int = Field(default=0, ge=0)
    playback: Playback = Field(default_factory=Playback)
