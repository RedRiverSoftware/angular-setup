var angular = require('angular');
var router = require('angular-ui-router');
var debug = require('debug')('angular-setup');
var Promise = require('bluebird');

module.exports = AngularSetup;

/*
 * Creates and configures an angular app, with the
 * idea of reducing repeated boilerplate.
 */

function AngularSetup(name) {
  if (!(this instanceof AngularSetup)) return new AngularSetup(name);
  this.name = name;
  this.deps = [router];
  this.configs = [];
  this.runs = [];
};

/*
 * Handy plugin thing with `fn`
 *
 * @param {Function} fn
 * @return {AngularSetup}
 * @public
 */

AngularSetup.prototype.use = function(fn) {
  fn(this)
  return this;
}


/*
 * Setup module
 *
 * @param {String|Array} deps
 * @return {AngularSetup}
 * @public
 */

AngularSetup.prototype.module = function(deps) {
  if (!Array.isArray(deps)) {
    deps = Array.prototype.slice.call(arguments);
  }
  this.deps = this.deps.concat(deps);
  return this;
}


/*
 * Setup Auth
 *
 * @param {String|Array} deps
 * @return {AngularSetup}
 * @public
 */

AngularSetup.prototype.auth = function(getToken) {
  this.runs.push(function(module){
    module.run(function($rootScope, $state, $interval, $http){

      function check(){
        debug('checking token');
        var token = getToken();
        var origToken = $rootScope.token;

        // no token - nothing changed
        if (!token && !origToken) return;

        token = token || {};
        origToken = origToken || {};

        // tokens expire same time - nothing changed
        if (token.expires_at === origToken.expires_at) return;

        // token has changed
        debug('token changed', token);
        $rootScope.token = token;
      }

      function refresh(){
        return $http.post('/auth/refresh').then(check);
      }

      check();
      refresh();
      $interval(refresh, 60 * 1000)
    })
  })
  return this;
}


/*
 * Pass in `fn` to run on angular module config
 *
 * @param {Function} fn
 * @return {AngularSetup}
 * @public
 */

AngularSetup.prototype.config = function(fn) {
  this.configs.push(fn);
  return this;
}


/*
 * Pass in `fn` to run on angular module run
 *
 * @param {Function} fn
 * @return {AngularSetup}
 * @public
 */

AngularSetup.prototype.run = function(fn) {
  this.runs.push(fn);
  return this;
}


/*
 * Sets up an angular state with given `name`
 * and state `opts`.
 *
 * @param {String} name
 * @param {Object} opts
 * @return {AngularSetup} this
 * @public
 */

AngularSetup.prototype.state = function(name, opts) {
  this.configs.push(function(module) {
    debug('%s : state setup "%s"', this.name, name);
    module.config(function($stateProvider) {
      $stateProvider.state(name, opts);
    })
  })
  return this;
}


/*
 * Trigger settings and create angular stuff
 *
 * @param {Angular Module} module
 * @private
 */

AngularSetup.prototype.defaultConfig = function(module) {
  module.config(function($locationProvider, $compileProvider) {
    $locationProvider.html5Mode({
      enabled: true,
      requireBase: false
    })
    $compileProvider.debugInfoEnabled(false);
  });
}


/*
 * Trigger settings and create angular stuff
 *
 * @param {Angular Module} module
 * @private
 */

AngularSetup.prototype.defaultRun = function(module) {
  var self = this;

  module.run(function($rootScope, $state) {
    debug('run', module)
    onStateChange(self.name, $state.current, $rootScope);

    // setup bluebird promise with angular.
    // http://stackoverflow.com/questions/23984471/how-do-i-use-bluebird-with-angular
    Promise.setScheduler(function(cb) {
      $rootScope.$evalAsync(cb);
    });

    $rootScope.$on('$stateChangeStart', function(e, toState) {
      onStateChange(self.name, toState, $rootScope);
      authenticateState($rootScope.token, toState, e);
    });
  })
}


/*
 * Trigger the angular setup.
 *
 * @return {Angular Module}
 * @public
 */

AngularSetup.prototype.done = function() {
  var module = angular.module(this.name, this.deps);
  debug('%s : setting up with deps %o', this.name, this.deps);

  var self = this;
  this.defaultConfig(module);

  // trigger config fns
  this.configs.forEach(function(fn){
    fn.call(self, module);
  })

  // trigger run fns
  this.runs.forEach(function(fn){
    fn.call(self, module);
  })

  this.defaultRun(module);

  return module;
}


/*
 * Configuration for state change stuff
 *
 * @param {String} name
 * @param {Object} toState
 * @param {$rootScope} $rootScope
 * @private
 */

function onStateChange(name, toState, $rootScope) {
  if (!toState.name) return;
  debug('%s : state change "%s"', name, toState.name);

  if (toState.data && toState.data.title) {
    document.title = toState.data.title;
  }
  $rootScope.stateName = (toState.name || '').replace(/\./g, '-');
}



function authenticateState(token, toState, event){
  var data = toState.data || {};
  var authenticate = data.authenticate;

  // no authentication required
  if (!authenticate) {
    debug('nav to "%s" (unauth)', toState.name);
    return;
  }

  // no auth but route request auth
  if (!token) {
    event.preventDefault();
    debug('nav to "%s" : requires auth - going to login', toState.name);
    window.location = '/login?redirect=' + toState.url;
    return;
  }

  var claims = data.claims || [];
  var claimFailed = false;

  claims.forEach(function(claim){
    var found = false;
    if (claimFailed) return;

    token.claims.forEach(function(c){
      if (found) return;
      if (claim.type == c.type && claim.value == c.value) {
        found = true;
      }
    })

    if (found) {
      debug('claim found "%s" with value "%s"', claim.type, claim.value);
      return;
    }

    claimFailed = true;

    if (claim.redirect) {
      event.preventDefault();
      debug('claim NOT found "%s" with value "%s" - redirecting to %s', claim.type, claim.value, claim.redirect);
      window.location = claim.redirect;
      return;
    }

    if (claim.state) {
      event.preventDefault();
      debug('claim NOT found "%s" with value "%s" - redirecting to state %s', claim.type, claim.value, claim.state);
      self.$state.go(claim.state);
      return;
    }

    throw new Error('somebody didnt specify a claim.state or claim.redirect')
  })

  if (token) {
    debug('nav to "%s"', toState.name);
    return;
  }
}
