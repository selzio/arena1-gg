import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackEndTracker} from '../public/playback-end.mjs';
const playing={active:1,start:10000,end:70000,time:69000,paused:0};
test('completion is shown once after active playback disconnects',()=>{
 const tracker=new PlaybackEndTracker();
 assert.equal(tracker.observe({active:0}),null);
 assert.equal(tracker.observe(playing),null);
 assert.equal(tracker.observe({active:0}),null);
 assert.deepEqual(tracker.observe({active:0}),{completed:true,duration:60000});
 assert.equal(tracker.observe({active:0}),null);
});
test('pause near the end and a short seek transition are not completion',()=>{
 const tracker=new PlaybackEndTracker();
 tracker.observe({...playing,paused:1});
 assert.equal(tracker.observe({...playing,paused:1}),null);
 assert.equal(tracker.observe({active:0}),null);
 assert.equal(tracker.observe({...playing,time:20000}),null);
 assert.equal(tracker.observe({active:0}),null);
});
test('replaying or selecting another demo resets completion tracking',()=>{
 const tracker=new PlaybackEndTracker(); tracker.observe(playing);
 tracker.observe({active:0}); tracker.observe({active:0});
 tracker.reset(); assert.equal(tracker.observe({active:0}),null);
 tracker.observe({...playing,time:20000}); tracker.observe({active:0});
 assert.deepEqual(tracker.observe({active:0}),{completed:false,duration:60000});
});
