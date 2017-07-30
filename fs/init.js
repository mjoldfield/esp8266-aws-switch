// Load Mongoose OS API
load('api_aws.js');
load('api_gpio.js');
load('api_timer.js');

// Constants for ESP8266
// TODO: support other platforms

let appTicker = { periodMS: 0
                , tasks: []
                , ticks: 0
};

let pendingChanges = false;

let state = {
  brightness: 0
};

function updateState(newSt) {
  if (newSt.brightness !== undefined) {
    state.brightness = newSt.brightness;
  }
  print("Remote update: ", JSON.stringify(state));
}

function reportState(state) {
  print("Reported state: ", JSON.stringify(state));
}

function bound(min,max,x) {
    if (x < min) { return min; }
    if (x > max) { return max; }
    return x;
}

function updateBrightness(delta) {
    let b = bound(0, 1000, state.brightness + delta);
    state.brightness = b;
    pendingChanges = true;
    print("Local update: ", JSON.stringify(state));
    
    let pushDelayMS = 100;
    
    doLater(pushDelayMS
            , function () { return pendingChanges; }
            , pushState
            , null);
}
 
function pushState() {
  if (pendingChanges) {
    let newState = {  
           desired: {
              brightness: state.brightness
        }
    };
    print("Pending changes: ", JSON.stringify(newState));
    let updRes = AWS.Shadow.update(0, newState);
    print("Update status:", updRes);
    pendingChanges = false;
  }
}

/*
 * Button handling code.
 * When pushed, update local state a bit.
 * If held down, update the local state so light turns fully
 * on or off.
 */
function setupButton(pin, delta) {
    GPIO.set_mode(pin, GPIO.MODE_INPUT);
    GPIO.set_button_handler(pin, GPIO.PULL_UP, GPIO.INT_EDGE_NEG
	                    , 50 /*debounce ms*/
	                    , buttonPressed
	                    , delta);
    GPIO.enable_int(pin);
}

function buttonPressed(pin, delta) {
  updateBrightness(delta);
  let onOffDelayMS = 500;
  
  doLater(onOffDelayMS
          , isButtonPressed
          , doOnOff
          , [pin, delta]);
}

function isButtonPressed(pd) {
  let pin   = pd[0];
  let state = GPIO.read(pin) === 0;
  return state;
}

function doOnOff(pd) {
  let delta = pd[1];
  updateBrightness(1000 * delta);
}

/*
 * A crude 'run regularly' task manager
 * Each task has a time to run, a predicate which
 * is polled to abort the task, and a action. Oh, 
 * there's also an opaque data blob because we don't
 * have closures in mjs.
 */
function doLater(deltaMS, predicate, action, userData) {
  let deltaTicks = deltaMS / appTicker.periodMS;
  
  let a = [ appTicker.ticks + deltaTicks, predicate, action, userData ];
  appTicker.tasks.splice(appTicker.tasks.length, 0, a);
}

function initAppTimer(periodMS) {
  appTicker.periodMS = periodMS;
  appTicker.ticks    = 1;
  appTicker.tasks    = [];
  Timer.set(appTicker.periodMS, true, appTimer, null);
}

function appTimer() {
  if (appTicker.tasks.length > 0) {
  
    let newList = [];
  
    for(let i = 0; i < appTicker.tasks.length; i++) {
      let p = appTicker.tasks[i];
      let alarmTime = p[0];
      let predicate = p[1];
      let action    = p[2];
      let userData  = p[3];
  
      let stillValid = predicate(userData);
      if (!stillValid) {
        continue;
      }
    
      if (alarmTime <= appTicker.ticks) {
        action(userData);
      }
      else {
        newList.splice(newList.length,0,p);
      }
    }
  
    appTicker.tasks = newList;
    appTicker.ticks++;
  }
  else {
    /* no tasks exist, so reset tick count to avoid problems
       with it getting too big */
    appTicker.ticks = 1;
  }
}

setupButton(12,  100); // 100 is the change when pushed
setupButton(13, -100);

initAppTimer(50); // 50ms polling

AWS.Shadow.setStateHandler(function(ud, ev, reported, desired, reported_md, desired_md) {
  print('Event:', ev, '('+AWS.Shadow.eventName(ev)+')');

  if (ev === AWS.Shadow.CONNECTED) {
    reportState();
    return;
  }

  if (ev !== AWS.Shadow.GET_ACCEPTED && ev !== AWS.Shadow.UPDATE_DELTA) {
    return;
  }

  print('Reported state:', JSON.stringify(reported));
  print('Desired state :', JSON.stringify(desired));

  /*
   * Here we extract values from previosuly reported state (if any)
   * and then override it with desired state (if present).
   */
  updateState(reported);
  updateState(desired);

  print('New state:', JSON.stringify(state));

  if (ev === AWS.Shadow.UPDATE_DELTA) {
    reportState();
  }
}, null);
