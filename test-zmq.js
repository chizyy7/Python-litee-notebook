// test-zmq.js
const zmq = require('zeromq');
console.log('zeromq module loaded');

try {
    console.log('Creating DEALER socket...');
    const dealer = new zmq.Dealer();
    console.log('DEALER socket created:', typeof dealer);
} catch (e) {
    console.error('Error creating DEALER:', e);
    process.exit(1);
}

try {
    console.log('Creating SUBSCRIBER socket...');
    const subscriber = new zmq.Subscriber();
    console.log('SUBSCRIBER socket created:', typeof subscriber);
} catch (e) {
    console.error('Error creating SUBSCRIBER:', e);
    process.exit(1);
}

// close sockets
try {
    dealer.close();
    console.log('DEALER closed');
} catch (e) {
    console.error('Error closing DEALER:', e);
}
try {
    subscriber.close();
    console.log('SUBSCRIBER closed');
} catch (e) {
    console.error('Error closing SUBSCRIBER:', e);
}

console.log('Test completed successfully');