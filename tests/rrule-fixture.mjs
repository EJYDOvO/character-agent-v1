// DSH 0.2.2 schedule_create takes an RFC 5545 subset. A one-time delivery is
// RRULE:FREQ=DAILY;COUNT=1 with DTSTART strictly after creation (UTC, whole seconds).
export function onceAfter(seconds,now=Date.now()){
 const at=new Date(Math.ceil(now/1000)*1000+seconds*1000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
 return `DTSTART:${at}\nRRULE:FREQ=DAILY;COUNT=1`;
}
