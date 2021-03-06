( function( window, atom, require, module, undefined ) {
	'use strict';

	// Imports
	var atomUtils = require( 'atom' );
	var spawn = require( 'win-spawn' );

	// Instance
	var commands = {
		subscriptions: new atomUtils.CompositeDisposable(),
		panel: null,
		config: require( './config' )
	}

	commands.activate = function( state ) {

		// Define and update a command list from the user config
		var registeredAtomCommands = [];

		atom.config.observe( 'atom-user-commands', {}, function( value ) {

			// Dispose old commands
			registeredAtomCommands.forEach( function( disposable ) {

				// Remove it from subscriptions and...
				commands.subscriptions.remove( disposable );

				// ... dispose it manually
				disposable.dispose();
			} );

			registeredAtomCommands = [];

			// Register new commands
			value.commands.forEach( function( command ) {

				// Create an atom command for each entry
				var commandName = 'atom-user-commands:' + command.name;
				var atomCommand = atom.commands.add( command.selector, commandName, function() {

					execute( command.command, command.arguments, command.options );
				} )

				// Create a menu entry for each command
				var menuEntry = atom.menu.add( [ {
					label : 'Packages',
					submenu: [ {
						label: 'Atom User Commands',
						submenu: [
							{
								label: command.name,
								command: commandName
							}
						]
					} ]
				} ] );

				// Register it in the subscriptions;
				registeredAtomCommands.push( atomCommand );
				registeredAtomCommands.push( menuEntry );

				commands.subscriptions.add( atomCommand );
				commands.subscriptions.add( menuEntry );
			} );
		} );
	}

	commands.deactivate = function() {
		commands.panel.destroy();
		commands.subscriptions.dispose();
	}

	commands.serialize = function() {
		return {};
	}

	// Create a bottom panel for the output
	function showConsole() {

		if ( !commands.panel ) {

			commands.panel = atom.workspace.addBottomPanel( {
				item: buildPanel(),
				visible: true,
				priority: 100
			} )
		};
	}

	// Destroy de bottom panel
	function hideConsole() {

		if ( commands.panel ) {
			commands.panel.destroy();
			commands.panel = null;
		}
	}

	// Clear de bottom panel
	function clearConsole() {
		if (commands.panel) {
			while (commands.panel.item.lastChild) {
				var child = commands.panel.item.lastChild;
				commands.panel.item.removeChild(child);
			}			
		}
	}
	
	// Output to de bottom panel
	function writeConsole( text, style ) {
		var div = commands.panel.item;
		var line = window.document.createElement( 'div' );
		line.classList.add( style );
		line.textContent = text;
		div.appendChild( line );
		div.scrollTop = div.scrollHeight;		
	}
	
	// Execute an OS command
	function execute( command, args, options ) {
		
		clearConsole();
		
		// Open the panel if it is not
		if ( !commands.panel ) {
			showConsole();
		}

		// Cancel the close console listener
		if (commands.closeConsoleDisposable) {
			commands.closeConsoleDisposable.dispose();
			commands.subscriptions.remove(commands.closeConsoleDisposable);
		}

		//writeConsole('? ' + JSON.stringify(args), 'echo');
		
		var env = getEnv();
		var command = replace( command || '', env );
		var args = replace( args || [], env );
		var options = replace( options || {}, env );
		//writeConsole('? ' + JSON.stringify(args), 'echo');	
		//writeConsole("> " + JSON.stringify( env), "echo");

		// Announcing launch
		commands.panel.item.appendChild( window.document.createElement( 'br' ) );
		var span = window.document.createElement( 'span' );
		span.classList.add( 'echo' );
		span.textContent = "> " + command + ' ' + JSON.stringify( args ) + ' ' + JSON.stringify( options );
		commands.panel.item.appendChild( span );
		commands.panel.item.appendChild( window.document.createElement( 'br' ) );
		//commands.panel.item.appendChild( window.document.createElement( 'br' ) );

		// record time
		var millisec = (new Date()).getTime();
		
		// Run the spawn, we pass args.slice() to make a shallow copy of the array because spawn will modify it.
		var proc = spawn( command, args.slice(), options );

		// Update console panel on data
		proc.stdout.on( 'data', function( data ) {
			writeConsole(data.toString(), 'stdout');
		} );

		// Update console panel on error data
		proc.stderr.on( 'data', function( data ) {
			writeConsole(data.toString(), 'stderr');
		} );

		proc.stdout.on( 'close', function( code, signal ) {
			// console.info('command closed', code, signal);
			var current = (new Date()).getTime();
			var delta = (current - millisec) * 0.001;
			writeConsole('[Finished in ' + delta.toString() + ' seconds]', 'stdout');
		} );

		// Register code for termination
		proc.stderr.on( 'close', function( code, signal ) {

			// Register an action for panel destruction
			commands.closeConsoleDisposable = atom.commands.add( 'atom-workspace', 'core:cancel', function() {
				hideConsole()
				commands.closeConsoleDisposable.dispose();
				commands.subscriptions.remove( commands.closeConsoleDisposable );
			} )

			commands.subscriptions.add( commands.closeConsoleDisposable );
		} );
	}

	// Set up the HTML element
	function buildPanel() {

		var mainDiv = window.document.createElement( 'div' );
		if (true) {
			mainDiv.classList.add( 'atom-user-commands-console' );
		}	else {
			var input = window.document.createElement( 'textarea' );
		  input.classList.add( 'console-input' );
			mainDiv.appendChild(input);
		}
		return mainDiv;

	}

	// Generate Environment variables
	function getEnv() {

		var paths = atom.project.relativizePath( atom.workspace.getActiveTextEditor().getPath() );
		var env = {
			project: paths[ 0 ],
			path: paths[ 1 ],
			absPath: atom.workspace.getActiveTextEditor().getPath()
		};

		return env;
	}

	// Replace members with env variables.
	function replace( input, vars ) {

		// Dispatch input type
		if ( !input ) {
			return;
		} else if ( typeof input == 'string' ) {
			return replaceString( input, vars );
		} else if ( Array.isArray( input ) ) {
			return replaceArray( input, vars );
		} else if ( typeof input == 'object' ) {
			return replaceObject( input, vars );
		} else {
			return input;
		}
	}

	// replace a string with vars.
	function replaceString( input, vars ) {

		var rgx = /{({?)(\w+)(}?)}/g

		var match = null;
		while ( match = rgx.exec( input ) ) {

			// {? + variable + }? so {{arg}} -> {arg}
			var key = match[ 1 ] + match[ 2 ] + match[ 3 ];
			var replacement = vars[ key ] || key;

			// Replace the result only on the remaining string
			input = input.substring( 0, match.index ) + input.substring( match.index ).replace( match[ 0 ], replacement );
			rgx.lastIndex = match.index + replacement.length;

			//console.info('replace', match[0], 'for', replacement, 'at', match.index, 'in', match.input, 'next on', rgx.lastIndex );
		}

		return input;
	}

	// Replace array string elements with variables
	function replaceArray( input, vars ) {
		var output = new Array(input.length);	
		for ( var i = 0; i < input.length; i++ ) {
			output[ i ] = replace( input[ i ], vars );
		}
		return output;
	}

	// Replaces oboject string members with variables
	function replaceObject( input, vars ) {
		var output = {};
		var keys = Object.keys( input );
		keys.forEach( function( key ) {
			output[ key ] = replace( input[ key ], vars );
		} );
		return output;
	}

	// TODO: Register active processes for killing;

	// Publishing a reference
	module.exports = commands;

} )( window, atom, require, module );
