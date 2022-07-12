const express = require("express");
const app = express();
const httpserver = require("http").createServer();
const WebSocket = require("ws");
const wss = new WebSocket.Server({server: httpserver, path: "/ws"});
const fs = require("fs");
const bodyParser = require("body-parser");
const path = require("path");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");
const auth = require("./scripts/auth.js");
const gamehandler = require("./scripts/game.js");
const emitter = require("events").EventEmitter;
const compression = require("compression");
const { resolve } = require("path");
const { rateLimit } = require("express-rate-limit");
/*Don't do it yourself, instead, be lazy and find a package that does it for you.
    -Sun Tzu, The Art of War
*/

if(process.env.PRODUCTION !== "yes") {
    console.log("Running in development environment!");
    require("dotenv").config();
} else {
    console.log("Running in production environment!");
}

//-- configs --
const authsecret = process.env.AUTHSECRET;
var port = process.env.SERVERPORT;

//GAME VERSION
const gameversion = "1.2.1 | 7/11/2022";

//mapname, maxplayers
const allmaps = {"miniworld": 3, "michigan": 6, "florida": 6};
//-- end configs --

//-- version --
console.log("Using game version " + gameversion);
//-- end version --

//-- player colors --
const playercoloroptions = ["red", "orange", "yellow", "green", "blue", "purple"];
//-- end player colors --

var hostname = process.env.HOSTNAME + ":" + port;
if(process.env.PRODUCTION === "yes") {
    hostname = process.env.HOSTNAME;
    if(process.env.PORT) {
        port = process.env.PORT;
    }
}

const game = new gamehandler();
const gameevents = gamehandler.gameevents;


//database -- make it later
//edit this in auth.json
var dbcredentials = null;
if(process.env.PRODUCTION === "yes") {
    dbcredentials = {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    };
    console.log("Database set to production mode");
} else {
    dbcredentials = {
        host: process.env.DATABASE_URL,
        user: process.env.DATABASE_USER,
        password: process.env.DATABASE_PASSWORD,
        port: process.env.DATABASE_PORT,
        database: process.env.DATABASE_NAME
    };
    console.log("Database set to development mode");
}

const pool = new Pool(dbcredentials);
pool.connect(function(err) {
    if (err) console.log(err);

    //export db configs
    module.exports.db = pool;

    console.log("Connected to database!");
    auth.getUserInfo("bobux");
});

const clients = new Map();
const rooms = [];
var userids = [];

function escapestring(str) {
    return (str + '').replace(/[\\"']/g, '\\$&').replace(/\u0000/g, '\\0');
}

function escapeHTML(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
 }

function randomnumber(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function removeFromArray(arr, item) {
    for (var i = arr.length; i--;) {
      if (arr[i] === item) arr.splice(i, 1);
    }
}

function requireHTTPS(req, res, next) {
    //for Heroku only
    if (!req.secure && req.get('x-forwarded-proto') !== 'https' && process.env.PRODUCTION === "yes") {
      return res.redirect('https://' + req.get('host') + req.url);
    }
    next();
}

//-- RATELIMITS --//
const apiLimiter = rateLimit({
	windowMs: 1 * 60000, //minutes
	max: 500,
    message: JSON.stringify({"error": 429, "message": "You are accessing the api too quickly (500 requests/min)! Try again in a minute. Calm down my guy."}),
	standardHeaders: true,
	legacyHeaders: false
})
const adminApiLimiter = rateLimit({
	windowMs: 1 * 60000, //minutes
	max: 20,
    message: JSON.stringify({"error": 429, "message": "You are accessing the auth api too quickly (20 requests/min)! Please go and bing chilling, and try again in a minute."}),
	standardHeaders: true,
	legacyHeaders: false
})

app.set("view engine", "html");
app.engine("html", require("ejs").renderFile);
app.set("views", path.join(__dirname, "./public"));
app.disable("x-powered-by");
app.use(requireHTTPS);
app.use(compression());
app.use("/api/", apiLimiter);
app.use("/authapi/", adminApiLimiter);

//enable req.body to be used
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());
app.use(cookieParser());

app.get("/", (req, res) => {
    let gettoken = req.cookies.auth;

    //for now, create a new game id (GID) every time a page loads for security
    //this way, leaking the game id won't compromise a player's "account"
    //replacement for user registration FOR NOW
    let chars = "1234567890qwertyuiopasdfghjklzxcvbnm";
    let id = "";
    for(let i=0; i<30; i++) {
        id += chars.charAt(randomnumber(0, chars.length-1));
    }
    res.cookie("GID", id);

    //-- USER AUTH (work in progress) --
    //does user have a token?

    //TODO: ADD USER REGISTRATION
    let u_info = [{user: "bobux"}]; //user info
    let userid = "69420666"; //user id
    let issuer = "bobux man" //issuer of token
    if(!gettoken) {
        //no token found... generate one
        let token = jwt.sign({
            data: u_info,
            sub: userid,
            iss: issuer
        }, authsecret);

        res.cookie("auth", token);
    } else {
        jwt.verify(gettoken, authsecret, function(err, decoded) {
            //invalid token, generate new one
            if(err || decoded.iss != issuer) {
                let token = jwt.sign({
                    data: u_info,
                    sub: userid,
                    iss: issuer
                }, authsecret);

                res.cookie("auth", token);
            } else {
                //do something with a valid token
                //console.log(decoded);
            }
        });
    }

    res.render("index", {
        host_name: hostname,
        prod: process.env.PRODUCTION,
        gameversion: gameversion
    });
});

httpserver.on("request", app);

app.get("/api", (req, res) => {
    res.json({"error": "invalid form body"});
});

app.get("/authapi", (req, res) => {
    res.json({"error": "invalid form body"});
});

app.get("/login", (req, res) => {
    res.render("login", {
        host_name: hostname
    });
});

app.get("/tutorial", (req, res) => {
    res.render("tutorial")
});

app.get("/admin", (req, res) => {
    res.render("admin");
});

//id = roomid
function getroommap(id) {
    for(let i=0; i<rooms.length; i++) {
        if(rooms[i].id === id) {
            return rooms[i].map.toString();
        }
    }
}

app.post("/authapi", (req, res) => {
    //admin functions
    if(req.body.action === "createpost") {
        if(req.body.auth !== process.env.ADMINMASTERPASSWORD) {
            res.status(403);
            res.json({"error": "403", "message": "You are not authorized to make this call!"});
            return;
        }
        auth.postAnnouncement(req.body.title, req.body.content, req.body.submittedtime, req.body.image).then(function() {
            res.json({"result": "post created successfully"});
        });
    } else if(req.body.action === "deletepost") {
        if(req.body.auth !== process.env.ADMINMASTERPASSWORD) {
            res.status(403);
            res.json({"error": "403", "message": "You are not authorized to make this call!"});
            return;
        }
        auth.deleteAnnouncement(req.body.postid).then(function() {
            res.json({"result": "deleted post"})
        });
    } else if(req.body.action === "validatepassword") {
        if(req.body.auth === process.env.ADMINMASTERPASSWORD) {
            res.json({"result": true});
        } else {
            res.json({"result": false});
        }
    }
});

app.post("/api", (req, res) => {
    try {
        if(req.body.action === "fetchposts") {
            if(!isNaN(Number(req.body.startindex)) && !isNaN(Number(req.body.amount))) {
                let startindex = req.body.startindex;
                let amount = req.body.amount;
                if(amount > 25) {
                    amount = 25;
                } else if(amount < 1) {
                    amount = 1;
                }

                if(startindex < 0 || startindex > 99999999) {
                    startindex = 0
                }
                auth.fetchAnnouncements(startindex, amount).then(function(result) {
                    res.json({"posts": result});
                });
            } else {
                res.status(400);
                res.json({"error": 400, "message": "Malformed request"});
            }
        } else if(req.body.action === "getmap") {
            var roommap = getroommap(req.body.roomid);
            fs.readFile("./mapdata/" + roommap + "/" + roommap + ".txt", "utf8", function(err, data) {
                fs.readFile("./mapdata/" + roommap + "/mapdict.json", "utf8", function(err, mapdict) {
                    fs.readFile("./mapdata/" + roommap + "/moves.json", "utf8", function(err, moves) {
                        fs.readFile("./mapdata/" + roommap + "/coordadjust.json", "utf8", function(err, coordadjust) {
                            fs.readFile("./mapdata/" + roommap + "/metadata.json", "utf8", function(err, metadata) {
                                res.json({"mapdata": data, "mapdict": mapdict, "moves": moves, "coordadjust": coordadjust, "metadata": metadata});
                            });
                        });
                    });
                });
            });
        } else if(req.body.action === "joingame") {
            //did player request for specific room?
            if(req.body.preset) {
                //does room exist?
                let preset = req.body.preset;
                let roomfound = false;
                for(let i=0; i<rooms.length; i++) {
                    if(rooms[i].id === preset) {
                        //is room full?
                        if(rooms[i]["players"] >= rooms[i]["maxplayers"]) {
                            res.json({"error": "room " + preset + " is full"});
                        } else {
                            res.json({"uid": userid(), "room": preset});
                        }
                        roomfound = true;
                        break;
                    }
                }
                if(!roomfound) {
                    res.json({"error": "room " + preset + " does not exist"});
                }
            } else {
                res.json({"uid": userid(), "room": joinroom(req.body.prefermap, req.body.createnewroom)});
            }
        } else if(req.body.action === "login") {
            // -- WORK ON PROGRESS --
            auth.getUserInfo("bobux").then(function(result) {
                res.json({"response": result})
            })
        } else {
            res.json({"error": "invalid form body"});
            res.end();
        }
    } catch(e) {
        console.log(e);
    }
});

app.use(express.static(__dirname + "/public"));

app.use(function(req, res, next) {
    res.status(404);
    res.sendFile("./public/errorpages/404.html", {root: __dirname});
});

//public id generator
function userid() {
    let chars = "1234567890qwertyuiopasdfghjklzxcvbnm";
    let id = "u-";
    for(let i=0; i<20; i++) {
        id += chars.charAt(randomnumber(0, chars.length-1));
    }
    while(userids.includes(id)) {
        let id = "u-"
        for(let i=0; i<20; i++) {
            id += chars.charAt(randomnumber(0, chars.length-1));
        }
    }
    userids.push(id);
    return id;
}

//if no username is specified, generate a random username
function genPname() {
    return "Player " + randomnumber(1, 999);
    //TODO: check and prevent duplicate names
}

//returns true if duplicate room ids exist
function checkDupeRoom(id) {
    for(let i=0; i<rooms.length; i++) {
        if(rooms[i].id === id) {
            return true;
        }
    }
}

function joinroom(map, createroom) {
    let roommap = "";
    let allmapnames = Object.keys(allmaps);
    let randommap = false;
    if(map !== "random" && allmapnames.includes(map)) {
        roommap = map;
    } else {
        roommap = allmapnames[Math.floor(Math.random()*allmapnames.length)];
        randommap = true;
    }

    let maxplayers = allmaps[roommap];
    let deploytime = 10;

    let isprivate = false;
    if(createroom) {
        isprivate = true;
    }

    if(rooms.length < 1 || createroom) {
        let chars = "1234567890qwertyuiopasdfghjklzxcvbnm";
        let id = "r-";
        for(let i=1; i<7; i++) {
            id += chars.charAt(randomnumber(0, chars.length-1));
        }

        while(checkDupeRoom(id)) {
            id = "r-";
            for(let i=1; i<7; i++) {
                id += chars.charAt(randomnumber(0, chars.length-1));
            }
        }
        
        rooms.push({"id": id, "isprivate": isprivate, "ingame": false, "map": roommap, "created": Math.floor(new Date().getTime()), "deploytime": deploytime, "maxplayers": maxplayers, "players": 0, "playersconfirmed": [], "playersready": 0, "playerslist": []});
        game.newGame(id, roommap, deploytime).then(function(result) {
            //console.log(result)
        });
        return id;
    } else {
        for(let i=0; i<rooms.length; i++) {
            //remove rooms with 0 users that persist longer than 30 seconds -- futureproof, also see line 380ish
            if(rooms[i]["players"] < 1) {
                if((Math.floor(new Date().getTime()) - rooms[i]["created"]) > 30000) {
                    game.removeGame(rooms[i].id);
                    rooms.splice(i, 1);
                }
            }

            //join room if available (and NOT in active game)
            if(rooms[i]["players"] < rooms[i]["maxplayers"] && rooms[i]["ingame"] == false && rooms[i]["isprivate"] == false) {
                if(randommap) {
                    return rooms[i]["id"];
                } else if(rooms[i]["map"] === roommap) {
                    return rooms[i]["id"];
                }
            }
        }

        let chars = "1234567890qwertyuiopasdfghjklzxcvbnm";
        let id = "r-";
        for(let i=1; i<7; i++) {
            id += chars.charAt(randomnumber(0, chars.length-1));
        }

        while(checkDupeRoom(id)) {
            id = "r-";
            for(let i=1; i<7; i++) {
                id += chars.charAt(randomnumber(0, chars.length-1));
            }
        }

        rooms.push({"id": id, "isprivate": isprivate, "ingame": false, "map": roommap, "created": Math.floor(new Date().getTime()), "maxplayers": maxplayers, "players": 0, "playersconfirmed": [], "playersready": 0, "playerslist": []});
        game.newGame(id, roommap, deploytime).then(function(result) {
            //console.log(result)
        });
        return id;
    }
}

httpserver.listen(port, function() {
    console.log("Server started on port " + port);
});

/* test:
setTimeout(function() {
    [...clients.keys()].forEach((client) => {
        client.send(JSON.stringify({"fard": "success"}));
    });
}, 10000);
*/

//send json message to all members in a room w/o request
function sendRoomMsg(roomid, message) {
    [...clients.keys()].forEach((client) => {
        let clientdata = clients.get(client);
        if(clientdata["room"] === roomid) {
            client.send(JSON.stringify(message));
        }
    });
}

gameevents.on("updateMap", function(result) {
    sendRoomMsg(result[0], {"updatemap": result[1]});
});

gameevents.on("startAttackPhase", function(result) {
    sendRoomMsg(result[0], {"startAttackPhase": "ok"});
    game.addTroopsPassively(result[0])
});

gameevents.on("startDeployPhase", function(result) {
    sendRoomMsg(result[0], {"startgame": true, "deploytime": result[1]/1000});
    let roomcount = rooms.length;
    for(let i=0; i<roomcount; i++) {
        if(rooms[i].id === result[0]) {
            rooms[i]["ingame"] = true;
            break;
        }
    }
});

gameevents.on("syncTroopTimer", function(result) {
    sendRoomMsg(result[0], {"syncTroopTimer": result[1]});
});

gameevents.on("updateLobbyTimer", function(result) {
    setTimeout(function() {
        sendRoomMsg(result[0], {"lobbytimer": Math.round(result[1]/1000)-1});
    }, 1000);
});

gameevents.on("playerdead", function(result) {
    sendRoomMsg(result[0], {"playerdead": result[1], "place": result[2]});
});

gameevents.on("playerWon", function(result) {
    sendRoomMsg(result[0], {"playerWon": result[1]});
});

//passively send messages to all users in room w/o request
//format: sendRoomMsg("room69", {"bobux": "momento"});

wss.on("connection", (ws) => {
    //passively send message to single player w/o request
    ws.send(JSON.stringify({"connection": "success"}));

    //send json message to all members in a room w/o request
    function sendRoomMsg(roomid, message) {
        [...clients.keys()].forEach((client) => {
            let clientdata = clients.get(client);
            if(clientdata["room"] === roomid) {
                //do everything in here
                client.send(JSON.stringify(message));
            }
        });
    }

    //passively send messages to all users in room w/o request
    //format: sendRoomMsg("room69", {"bobux": "momento"});

    ws.on("message", (response) => {
        //RESPONDS TO A SINGULAR PLAYER REQUEST
        let message = response.toString();
        let action = JSON.parse(message).action;

        //auth
        if(action !== "userlogin") {
            if(clients.get(ws).gid !== JSON.parse(message).gid || clients.get(ws).uid !== JSON.parse(message).uid) {
                ws.send(JSON.stringify({"error": "invalid credentials"}));
                return;
            }
        }

        if(action === "userlogin") {
            let userinfo = JSON.parse(message);
            let uid = escapeHTML(userinfo.uid);
            let room = escapeHTML(userinfo.roomid);
            let gid = userinfo.gid;

            //is room full? as a double check measure
            //first add the player to the total room count though before checking
            let totalroomcount = rooms.length;
            for(let i=0; i<totalroomcount; i++) {
                if(rooms[i].id === room) {
                    rooms[i]["players"]++;
                    if(rooms[i]["players"] > 1) {
                        if(game.queryGameStatus(rooms[i]["id"]) === "lobby") {
                            game.resumeLobbyTimer(rooms[i]["id"]);
                        }
                    }
                    break;
                }
            }
            let roomplayercount = rooms.filter(function(item) {
                return item.id === room;
            });
            roomplayercount = roomplayercount[0];
            let maxroomplayers = roomplayercount.maxplayers;
            roomplayercount = roomplayercount.players;
            if(roomplayercount > maxroomplayers) {
                ws.send(JSON.stringify({"error": "roomfull"}));
            }

            let pname = escapeHTML(userinfo.pname).substring(0, 18);
            let pcolor = escapeHTML(userinfo.pcolor);
            //player name not set, assign a random one
            if(pname === "") {
                pname = genPname();
            }

            //no player color set? assign red
            if(pcolor === "") {
                pcolor = "red";
            }

            //give players their preferred color; if taken, assign a different random color
            for(let i=0; i < rooms.length; i++) {
                if (rooms[i].id === room) {
                    let takencolors = [];
                    let availablecolors = playercoloroptions;
                    let playerliststring = rooms[i]["playerslist"];
                    for(let i=0; i<playerliststring.length; i++) {
                        takencolors.push(playerliststring[i]["pcolor"]);
                    }
                    
                    if(takencolors.includes(pcolor)) {
                        for(let i=0; i<takencolors.length; i++) {
                            availablecolors = availablecolors.filter(function(item) {
                                return item !== takencolors[i];
                            });
                        }
                        pcolor = availablecolors[(Math.random() * availablecolors.length) | 0];
                    }
                    break;
                }
            }
            
            var metadata = {uid, room, pname, pcolor, gid};
            clients.set(ws, metadata);

            ws.send(JSON.stringify({"setcolor": pcolor}));

            //add pname to room list
            let tclient = clients.get(ws);
            for (var i=0; i < rooms.length; i++) {
                if (rooms[i].id === tclient.room) {
                    rooms[i]["playerslist"].push({"id": uid, "name": pname, "pcolor": pcolor});
                    game.addPlayer(tclient.room, uid).then(function(result) {
                        //console.log(result);
                    })
                    break;
                }
            }

            ws.send(JSON.stringify({"mapname": getroommap(tclient.room)}));
        } else if (action === "mapready") {
            let tclient = clients.get(ws);
            for (var i=0; i < rooms.length; i++) {
                if (rooms[i].id === tclient.room) {
                    rooms[i]["playersready"]++;
                    break;
                }
            }
        } else if (action === "userconfirm") {
            let tclient = clients.get(ws);
            for (var i=0; i < rooms.length; i++) {
                if (rooms[i].id === tclient.room) {
                    if(!rooms[i]["playersconfirmed"].includes(JSON.parse(message).uid)) {
                        rooms[i]["playersconfirmed"].push(JSON.parse(message).uid);
                    }

                    if(rooms[i]["playersconfirmed"].length == rooms[i]["players"] && rooms[i]["players"] > 1) {
                        game.skipLobbyTimer(rooms[i].id);
                    }
                    break;
                }
            }
        /* NOTE: also leave EVERY player move handler down here since message sending is done separately.
           This is to stop a new event emitter from being created for every player */
        } else if(action === "deploy") {
            //see game.js, deployTroops
            game.deployTroops(JSON.parse(message).roomid, JSON.parse(message).uid, JSON.parse(message).target);
        } else if(action === "attack") {
            game.attackTerritory(JSON.parse(message).roomid, JSON.parse(message).uid, JSON.parse(message).start, JSON.parse(message).target, JSON.parse(message).trooppercent);
        }
    
        //EVERYTHING BELOW HERE WILL BE SENT TO ALL MEMBERS OF A ROOM
        [...clients.keys()].forEach((client) => {
            let clientdata = clients.get(client);

            if(clientdata["room"] === JSON.parse(message).roomid) {
                //to simplify things a little
                function sendmsg(message) {
                    client.send(JSON.stringify(message));
                }

                //begin possible inbound commands
                if(action === "mapready") {
                    sendmsg({"usersready": rooms[i]["playersready"]});
                    //console.log(rooms[i]["playersready"] + " / " + rooms[i]["players"])
                    if(rooms[i]["playersready"] == rooms[i]["players"]) {
                        sendmsg({"message": "all users loaded"});
                        sendmsg({"users": rooms[i]["playerslist"], "playersconfirmed": rooms[i]["playersconfirmed"]});
                    }
                } else if(action === "userlogin") {
                    sendmsg({"users": rooms[i]["playerslist"], "playersconfirmed": rooms[i]["playersconfirmed"], "isprivateroom": rooms[i]["isprivate"]});
                } else if(action === "userconfirm") {
                    sendmsg({"confirmedusers": rooms[i]["playersconfirmed"]});
                }
            }
        });
    });

    ws.on("close", () => {
        let removeclient = clients.get(ws);
        let removeclientid = removeclient.uid;
        removeFromArray(userids, removeclientid);
        for (var i=0; i < rooms.length; i++) {
            if (rooms[i].id === removeclient.room) {
                rooms[i]["players"]--;
                if(rooms[i]["players"] < 2) {
                    if(game.queryGameStatus(rooms[i]["id"]) === "lobby") {
                        game.pauseLobbyTimer(rooms[i]["id"]);
                    }
                }
                if(rooms[i].ingame) {
                    rooms[i]["playersready"]--;
                }

                //splice client id as well
                if(rooms[i]["players"] < 1) {
                    game.removeGame(rooms[i].id);
                    rooms.splice(i, 1);
                }
                break;
            }
        }
        clients.delete(ws);
  
        game.removePlayer(removeclient.room, removeclientid)
        gameevents.once("removePlayer" + removeclient.room, function(result) {
            //console.log(result);
        });

        //EVERYTHING BELOW HERE WILL BE SENT TO ALL MEMBERS OF A ROOM
        [...clients.keys()].forEach((client) => {
            let clientdata = clients.get(client);

            if(clientdata["room"] === removeclient.room) {
                //to simplify things a little
                function sendmsg(message) {
                    client.send(JSON.stringify(message));
                }

                rooms[i]["playerslist"] = rooms[i]["playerslist"].filter(function(item) {
                    return item.id !== removeclientid;
                });

                rooms[i]["playersconfirmed"] = rooms[i]["playersconfirmed"].filter(e => e !== removeclientid);

                sendmsg({"playerleft": removeclientid});
            }
        });
    });
});

process.on("uncaughtException", function(error) {
    console.log(error.stack);
});