import {generateApprovalDemoKey} from '../src/modules/letters/keys.js';
console.log('DEMO KEY ready:',await generateApprovalDemoKey());
console.log('Private key is in ignored var/keys. This key verifies letters issued by this demo system only.');
