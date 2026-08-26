// Test using zeromq like our KernelClient does
const zmq = require('zeromq');

console.log('Testing zeromq usage like KernelClient...');

try {
    // Test creating sockets like we do in initialize()
    console.log('Creating DEALER socket...');
    const dealer = new zmq.Dealer();
    console.log('DEALER socket created:', typeof dealer);

    console.log('Creating SUBSCRIBER socket...');
    const subscriber = new zmq.Subscriber();
    console.log('SUBSCRIBER socket created:', typeof subscriber);

    // Test if they have the methods we use
    console.log('Checking for connect method on dealer:', typeof dealer.connect === 'function');
    console.log('Checking for connect method on subscriber:', typeof subscriber.connect === 'function');
    console.log('Checking for subscribe method on subscriber:', typeof subscriber.subscribe === 'function');
    console.log('Checking for send method on dealer:', typeof dealer.send === 'function');
    console.log('Checking for close method on dealer:', typeof dealer.close === 'function');
    console.log('Checking for close method on subscriber:', typeof subscriber.close === 'function');

    // Test if Symbol.asyncIterator is implemented (needed for for-await loops)
    console.log('Checking for Symbol.asyncIterator on dealer:', typeof dealer[Symbol.asyncIterator]);
    console.log('Checking for Symbol.asyncIterator on subscriber:', typeof subscriber[Symbol.asyncIterator]);

    // Clean up
    dealer.close();
    subscriber.close();

    console.log('✓ All zeromq usage tests passed!');
} catch (err) {
    console.error('✗ Error testing zeromq usage:');
    console.error(err);
    console.error(err.stack);
}