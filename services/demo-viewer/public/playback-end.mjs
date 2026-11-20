// Watch engine state transitions, not a timer: pausing/seeking is not completion.
export class PlaybackEndTracker {
  reset() { this.lastPlaying=null; this.inactivePolls=0; this.ended=false; }
  constructor() { this.reset(); }
  observe(state) {
    if (this.ended) return null;
    if (state.active) {
      this.lastPlaying={...state}; this.inactivePolls=0; return null;
    }
    // A short loading/seek transition can be inactive for one poll.
    if (!this.lastPlaying || ++this.inactivePolls < 2) return null;
    this.ended=true;
    const {time,start,end}=this.lastPlaying;
    const duration=Math.max(0,end-start);
    return {completed:duration>0 && time>=start && end-time<=5000, duration};
  }
}
