/// <reference path="../typings/angularjs/angular.d.ts" />
/// <reference path="../typings/angularjs/angular-route.d.ts" />
var eMusicality;
(function (eMusicality) {
    const debugEnabled = true;
    function config() {
        let fn = function ($routeProvider, $logProvider) {
            $routeProvider
                .when("/home", { templateUrl: "home.html", controller: Home.Controller, controllerAs: "ctrl" })
                .when("/player/:songId", { templateUrl: "player.html", controller: Player.Controller, controllerAs: "ctrl" })
                .otherwise({ redirectTo: "/home" })
                .caseInsensitiveMatch = true;
            $logProvider.debugEnabled(debugEnabled);
        };
        fn.$inject = ["$routeProvider", "$logProvider"];
        return fn;
    }
    eMusicality.config = config;
    function run() {
        let fn = function () {
        };
        fn.$inject = [];
        return fn;
    }
    eMusicality.run = run;
    let Home;
    (function (Home) {
        class Controller {
            constructor($emu, $scope) {
                this.songs = [];
                $scope.$on("$routeChangeSuccess", function ($event, next, current) {
                });
                $emu.songs().then((response) => { this.songs = response; });
            }
            $postLink() { }
        }
        Controller.$inject = ["$emu", "$scope"];
        Home.Controller = Controller;
    })(Home || (Home = {}));
    let Player;
    (function (Player) {
        class Controller {
            constructor($emu, $tone, $scope, $routeParams, $location, $timeout) {
                this.$tone = $tone;
                this.$scope = $scope;
                this.$timeout = $timeout;
                /* Volume Controls */
                this.volumes = [
                    { value: "mute", faIcon: "fa-volume-off" },
                    { value: "normal", faIcon: "fa-volume-down" },
                    { value: "boost", faIcon: "fa-volume-up" }
                ];
                $emu.songs().then((response) => {
                    this.song = response[parseInt($routeParams["songId"])];
                    if (angular.isUndefined(this.song))
                        $location.path("/home");
                    $tone.load(this.song);
                });
            }
            get loaded() { return this.$tone.isLoaded; }
            /* Phrasing */
            get beatIndex() {
                if (Tone.Transport.seconds < this.song.offset)
                    return 0;
                return Math.round((Tone.Transport.seconds - this.song.offset) / this.$tone.secondsPerBeat) + 1;
            }
            get section() {
                for (var i = this.song.sections.length - 1; i > 0; i--)
                    if (this.song.sections[i].startIndex <= this.beatIndex)
                        break;
                return this.song.sections[i];
            }
            get oddPhrase() { return this.section.bars % 2 === 1; }
            get measures() { return Math.ceil(this.section.bars / 2); }
            get measure() { return (Math.floor((this.beatIndex - (this.section.startIndex || 1)) / 8) + 1) || 1; }
            get measureMarkers() { return markers(this.measures); }
            get beats() { return this.oddPhrase && this.measure === this.measures ? 4 : 8; }
            get beat() { return ((this.beatIndex - (this.section.startIndex || 1)) % this.beats) + 1; }
            get beatMarkers() { return markers(this.beats); }
            volumeBtnClass(track, volume) {
                let btnClass = {};
                if (track.volume === volume.value)
                    btnClass["btn-info"] = true;
                else
                    btnClass["btn-outline-info"] = true;
                return btnClass;
            }
            setVolume(track, volume, $event) {
                this.$tone.setVolume(track, volume, $event);
            }
            /* Transport Controls */
            secondsAtBeatIndex(beatIndex) {
                if (beatIndex === 0)
                    return 0;
                return ((60 / this.song.bpm) * (beatIndex - 1)) + this.song.offset;
            }
            goToBeatIndex(beatIndex) {
                if (beatIndex === 0) {
                    if (this.playing) {
                        Tone.Transport.stop();
                        this.$timeout(250).then(() => {
                            Tone.Transport.start();
                        });
                    }
                    else
                        Tone.Transport.stop();
                }
                else
                    Tone.Transport.seconds = new Tone.Time(Math.floor(beatIndex / 4) + ":" + ((beatIndex - 1) % 4)).toSeconds() + this.song.offset;
            }
            restart($event) {
                cancel($event);
                this.goToBeatIndex(0);
            }
            back($event) {
                cancel($event);
                if (this.measure > 1)
                    this.goToBeatIndex(this.section.startIndex);
                else if (this.section.previous())
                    this.goToBeatIndex(this.section.previous().startIndex);
            }
            next($event) {
                cancel($event);
                if (this.section.next())
                    this.goToBeatIndex(this.section.next().startIndex);
            }
            get playing() { return Tone.Transport.state === "started"; }
            toggle($event) {
                Tone.start();
                if (Tone.Transport.state === "started")
                    Tone.Transport.pause();
                else
                    Tone.Transport.start();
            }
            $postLink() { }
        }
        Controller.$inject = ["$emu", "$tone", "$scope", "$routeParams", "$location", "$timeout"];
        Player.Controller = Controller;
    })(Player || (Player = {}));
    let Playlist;
    (function (Playlist) {
        class Service {
            constructor($http, $q) {
                this.$http = $http;
                this.$q = $q;
                this._loaded = false;
                this._songs = [];
            }
            songs() {
                let deferred = this.$q.defer();
                if (this._loaded)
                    deferred.resolve(this._songs);
                else
                    this.$http.get("songs/songs.json")
                        .then((response) => {
                        angular.forEach(response.data, (song) => { new Song(this._songs, song); });
                        this._loaded = true;
                        deferred.resolve(this._songs);
                    });
                return deferred.promise;
            }
        }
        Service.$inject = ["$http", "$q"];
        Playlist.Service = Service;
    })(Playlist = eMusicality.Playlist || (eMusicality.Playlist = {}));
    let ToneHandler;
    (function (ToneHandler) {
        class Service {
            constructor($rootScope, $timeout) {
                this.$rootScope = $rootScope;
                this.$timeout = $timeout;
                this._players = [];
                this._events = [];
                $rootScope.$on("$routeChangeSuccess", () => { this.stop(); });
            }
            get isPlaying() { return Tone.Transport.state === "started"; }
            play() { Tone.start(); if (!this.isPlaying)
                Tone.Transport.start(); }
            pause() { if (this.isPlaying)
                Tone.Transport.pause(); }
            stop() { Tone.Transport.stop(); }
            get isLoaded() {
                if (!this._players.length)
                    return false;
                var loaded = true;
                for (var i = 0; i < this._players.length; i++) {
                    if (!this._players[i].loaded) {
                        loaded = false;
                        break;
                    }
                }
                return loaded;
            }
            unload() {
                this.stop();
                while (this._players.length)
                    this._players.pop().dispose();
                while (this._events.length)
                    Tone.Transport.clear(this._events.pop());
            }
            load(song) {
                this.unload();
                Tone.Transport.bpm.value = song.bpm;
                this._secondsPerBeat = new Tone.Time("4n").toSeconds();
                angular.forEach(song.tracks, (track) => {
                    var player = new Tone.Player(track.audioUrl, () => { this.$rootScope.$apply(); });
                    player.sync().start(track.offset).toMaster();
                    player.volume.value = track.volumeNormal;
                    this._players.push(player);
                });
                this._events.push(Tone.Transport.scheduleRepeat((time) => {
                    Tone.Draw.schedule(() => {
                        this.$rootScope.$apply();
                    }, time);
                }, "4n", song.offset, ((song.endIndex - 2) * this.secondsPerBeat) + song.offset));
                this._events.push(Tone.Transport.scheduleOnce((time) => {
                    Tone.Draw.schedule(() => {
                        this.stop();
                        this.$rootScope.$apply();
                    }, time);
                }, ((song.endIndex - 1) * this.secondsPerBeat) + song.offset));
            }
            setVolume(track, volume, $event) {
                cancel($event);
                let player = this._players[track.id];
                switch (volume.value) {
                    case "mute":
                        player.mute = true;
                        break;
                    case "normal":
                        player.mute = false;
                        player.volume.value = track.volumeNormal;
                        break;
                    case "boost":
                        player.mute = false;
                        player.volume.value = track.volumeBoost;
                        break;
                }
                track.volume = volume.value;
            }
            get secondsPerBeat() { return this._secondsPerBeat; }
        }
        Service.$inject = ["$rootScope", "$timeout"];
        ToneHandler.Service = Service;
    })(ToneHandler = eMusicality.ToneHandler || (eMusicality.ToneHandler = {}));
    class Song {
        constructor(_songs, song) {
            this._songs = _songs;
            this.tracks = [];
            this.sections = [];
            this._songs.push(this);
            this.title = song.title;
            this.artist = song.artist;
            this.imageUrl = "songs/" + this.id + "/" + song.imageUrl;
            this.downloadUrl = song.downloadUrl || null;
            this.bpm = song.bpm;
            this.offset = song.offset || 0;
            angular.forEach(song.tracks, (track) => { new Track(this.id, this.tracks, track); });
            angular.forEach(song.sections, (section) => { new Section(this.sections, section); });
            this.endIndex = this.sections[this.sections.length - 1].startIndex + (this.sections[this.sections.length - 1].bars * 4);
        }
        get id() { return this._songs.indexOf(this); }
        get multitrack() { return this.tracks.length > 1; }
    }
    eMusicality.Song = Song;
    class Track {
        constructor(songId, _tracks, track) {
            this._tracks = _tracks;
            this._tracks.push(this);
            this.description = track.description;
            this.audioUrl = "songs/" + songId + "/" + track.audioUrl;
            this.offset = track.offset || 0;
            this.volumeNormal = track.volumeNormal || -10;
            this.volumeBoost = track.volumeBoost || 0;
            this.volume = "normal";
        }
        get id() { return this._tracks.indexOf(this); }
    }
    eMusicality.Track = Track;
    class Section {
        constructor(_sections, section) {
            this._sections = _sections;
            _sections.push(this);
            this.description = section.description;
            this.structure = section.structure;
            this.bars = section.bars;
            if (this.id === 0)
                this.startIndex = 0;
            else {
                let previous = this._sections[this.id - 1];
                this.startIndex = (previous.startIndex || 1) + (previous.bars * 4);
            }
        }
        get id() { return this._sections.indexOf(this); }
        previous() {
            if (this.id === 0)
                return;
            return this._sections[this.id - 1];
        }
        next() {
            if (this.id + 1 >= this._sections.length)
                return;
            return this._sections[this.id + 1];
        }
    }
    eMusicality.Section = Section;
    eMusicality.sixteen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    function markers(count) { return eMusicality.sixteen.slice(0, count); }
    eMusicality.markers = markers;
    function cancel($event) {
        if (!$event)
            return;
        $event.preventDefault();
        $event.stopPropagation();
    }
    eMusicality.cancel = cancel;
})(eMusicality || (eMusicality = {}));
angular.module("emusicality", ["ngRoute", "ngSanitize"])
    .config(eMusicality.config())
    .run(eMusicality.run())
    .service("$emu", eMusicality.Playlist.Service)
    .service("$tone", eMusicality.ToneHandler.Service);
//# sourceMappingURL=emusicality.js.map