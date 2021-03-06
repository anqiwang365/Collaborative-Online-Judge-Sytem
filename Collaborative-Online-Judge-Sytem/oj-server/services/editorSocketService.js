var redisClient = require('../modules/redisClient');

const TIMEOUT_IN_SECONDS = 3600;

module.exports = function(io) {
    // collaboration sessions
    var collaborations = [];

    var socketIdToSessionId = [];

    var sessionPath = '/oj_server/';
    io.on('connection', (socket) => {

        var sessionId = socket.handshake.query['sessionId'];
        socketIdToSessionId[socket.id] = sessionId;
        if (sessionId in collaborations) {
            collaborations[sessionId]['participants'].push(socket.id);
        } else {
            redisClient.get(sessionPath + sessionId, function(data) {
                if (data) {
                    collaborations[sessionId] = {
                        'cachedInstructions': JSON.parse(data),
                        'participants': []
                    };
                } else {
                    collaborations[sessionId] = {
                        'cachedInstructions': [],
                        'participants': []
                    }
                }
                collaborations[sessionId]['participants'].push(socket.id);
            });
        }

        // add change event listener
        socket.on('change', delta => {
            let sessionId = socketIdToSessionId[socket.id];
            if (sessionId in collaborations) {
                collaborations[sessionId]['cachedInstructions'].push(
                    ['change', delta, Date.now()]
                );
            }
            forwardEvent(socket.id, 'change', delta);
        });

        // socket cursorMove update
        socket.on('cursorMove', cursor => {
            console.log('cursorMove ' + socketIdToSessionId[socket.id] + ' ' + cursor);
            cursor = JSON.parse(cursor);
            cursor['socketId'] = socket.id;
            forwardEvent(socket.id, 'cursorMove', JSON.stringify(cursor));
        });

        socket.on('restoreBuffer', () => {
            var sessionId = socketIdToSessionId[socket.id];
            console.log('restore buffer to session: ' + sessionId );

            if (sessionId in collaborations) {
                let cachedInstructions = collaborations[sessionId]['cachedInstructions'];
                for (let i = 0; i < cachedInstructions.length; i++) {
                    socket.emit(cachedInstructions[i][0], cachedInstructions[i][1]);
                }
            } else {
                console.log('WARNING');
            }
        });

        socket.on('disconnect', () => {
            var sessionId = socketIdToSessionId[socket.id];
            console.log('socket ' + socket.id + ' disconnected from session: ' + sessionId);
            var foundAndRemoved = false;
            if (sessionId in collaborations) {
                var participants = collaborations[sessionId]['participants'];
                var index = participants.indexOf(socket.id);
                if (index >= 0) {
                    participants.splice(index, 1);
                    foundAndRemoved = true;

                    if (participants.length === 0) {
                        console.log('last participant left, saving to Redis');

                        let key = sessionPath + sessionId;
                        let value = JSON.stringify(collaborations[sessionId]['cachedInstructions']);

                        redisClient.set(key, value, redisClient.redisPrint);
                        redisClient.expire(key, TIMEOUT_IN_SECONDS);
                        delete collaborations[sessionId];
                    }
                }
            }
            if (!foundAndRemoved) {
                console.log('WARNING!');
            }
        });

    });

    var forwardEvent = function(socketId, eventName, dataString) {
        let sessionId = socketIdToSessionId[socketId];
        if (sessionId in collaborations) {
            let participants = collaborations[sessionId]['participants'];
            for (let i = 0; i < participants.length; i++) {
                if ( socketId != participants[i]) {
                    io.to(participants[i]).emit(eventName, dataString);
                }
            }
        } else {
            console.log('WARNING!!!!!');
        }
    }
}
