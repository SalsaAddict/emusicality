/// <reference path="../typings/angularjs/angular.d.ts" />
/// <reference path="../typings/angularjs/angular-route.d.ts" />

declare var Tone: any;

namespace eMusicality {
    const debugEnabled: boolean = true;
    export function config(): ng.Injectable<Function> {
        let fn: Function = function ($routeProvider: ng.route.IRouteProvider, $logProvider: ng.ILogProvider): void {
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
    export function run(): ng.Injectable<Function> {
        let fn: Function = function (): void { };
        fn.$inject = [];
        return fn;
    }
    namespace Home {
        export class Controller implements ng.IController {
            static $inject: string[] = ["$emu", "$scope"];
            constructor($emu: Playlist.Service, $scope: ng.IScope) {
                $scope.$on("$routeChangeSuccess", function (
                    $event: ng.IAngularEvent,
                    next: ng.route.IRoute,
                    current: ng.route.ICurrentRoute): void {
                });
                $emu.songs().then((response: Song[]): void => { this.songs = response; });
            }
            public songs: Song[] = [];
            public $postLink(): void { }
        }
    }
    namespace Player {
        export class Controller implements ng.IController {
            static $inject: string[] = ["$emu", "$tone", "$scope", "$routeParams", "$location", "$timeout"];
            constructor(
                $emu: Playlist.Service,
                public $tone: ToneHandler.Service,
                private $scope: ng.IScope,
                $routeParams: ng.route.IRouteParamsService,
                $location: ng.ILocationService,
                private $timeout: ng.ITimeoutService) {
                $emu.songs().then((response: Song[]): void => {
                    this.song = response[parseInt($routeParams["songId"])];
                    if (angular.isUndefined(this.song)) $location.path("/home");
                    $tone.load(this.song);
                });
            }
            public song: Song;
            public get loaded(): boolean { return this.$tone.isLoaded; }
            /* Phrasing */
            public get beatIndex(): number {
                if (Tone.Transport.seconds < this.song.offset) return 0;
                return Math.round((Tone.Transport.seconds - this.song.offset) / this.$tone.secondsPerBeat) + 1;
            }
            public get section(): Section {
                for (var i: number = this.song.sections.length - 1; i > 0; i--)
                    if (this.song.sections[i].startIndex <= this.beatIndex) break;
                return this.song.sections[i];
            }
            public get oddPhrase(): boolean { return this.section.bars % 2 === 1; }
            public get measures(): number { return Math.ceil(this.section.bars / 2); }
            public get measure(): number { return (Math.floor((this.beatIndex - (this.section.startIndex || 1)) / 8) + 1) || 1; }
            public get measureMarkers(): number[] { return markers(this.measures); }
            public get beats(): number { return this.oddPhrase && this.measure === this.measures ? 4 : 8; }
            public get beat(): number { return ((this.beatIndex - (this.section.startIndex || 1)) % this.beats) + 1; }
            public get beatMarkers(): number[] { return markers(this.beats); }
            /* Volume Controls */
            public volumes: IVolume[] = [
                { value: "mute", faIcon: "fa-volume-off" },
                { value: "normal", faIcon: "fa-volume-down" },
                { value: "boost", faIcon: "fa-volume-up" }
            ];
            public volumeBtnClass(track: Track, volume: IVolume): any {
                let btnClass: INgClass = {};
                if (track.volume === volume.value)
                    btnClass["btn-info"] = true;
                else
                    btnClass["btn-outline-info"] = true;
                return btnClass;
            }
            public setVolume(track: Track, volume: IVolume, $event: ng.IAngularEvent): void {
                this.$tone.setVolume(track, volume, $event);
            }
            /* Transport Controls */
            public secondsAtBeatIndex(beatIndex: number): number {
                if (beatIndex === 0) return 0;
                return ((60 / this.song.bpm) * (beatIndex - 1)) + this.song.offset;
            }
            public goToBeatIndex(beatIndex: number): void {
                if (beatIndex === 0) {
                    if (this.playing) {
                        Tone.Transport.stop();
                        this.$timeout(250).then((): void => {
                            Tone.Transport.start();
                        });
                    }
                    else Tone.Transport.stop();
                }
                else
                    Tone.Transport.seconds = new Tone.Time(Math.floor(beatIndex / 4) + ":" + ((beatIndex - 1) % 4)).toSeconds() + this.song.offset;
            }
            public restart($event: ng.IAngularEvent): void {
                cancel($event);
                this.goToBeatIndex(0);
            }
            public back($event: ng.IAngularEvent): void {
                cancel($event);
                if (this.measure > 1)
                    this.goToBeatIndex(this.section.startIndex);
                else
                    if (this.section.previous()) this.goToBeatIndex(this.section.previous().startIndex);
            }
            public next($event: ng.IAngularEvent): void {
                cancel($event);
                if (this.section.next()) this.goToBeatIndex(this.section.next().startIndex);
            }
            public get playing(): boolean { return Tone.Transport.state === "started"; }
            public toggle($event: ng.IAngularEvent): void {
                Tone.start();
                if (Tone.Transport.state === "started")
                    Tone.Transport.pause();
                else
                    Tone.Transport.start();
            }
            public $postLink(): void { }
        }
    }
    export namespace Playlist {
        export class Service {
            static $inject: string[] = ["$http", "$q"];
            constructor(private $http: ng.IHttpService, private $q: ng.IQService) { }
            private _loaded: boolean = false;
            private _songs: Song[] = [];
            public songs(): ng.IPromise<Song[]> {
                let deferred: ng.IDeferred<Song[]> = this.$q.defer();
                if (this._loaded) deferred.resolve(this._songs);
                else this.$http.get("songs/songs.json")
                    .then((response: ng.IHttpPromiseCallbackArg<ISong[]>): void => {
                        angular.forEach(response.data, (song: ISong): void => { new Song(this._songs, song); });
                        this._loaded = true;
                        deferred.resolve(this._songs);
                    });
                return deferred.promise;
            }
        }
    }
    export namespace ToneHandler {
        export class Service {

            static $inject: string[] = ["$rootScope", "$timeout"];
            constructor(
                private $rootScope: ng.IRootScopeService,
                private $timeout: ng.ITimeoutService) {
                $rootScope.$on("$routeChangeSuccess", (): void => { this.stop(); });
            }

            private _players: any[] = [];
            private _events: number[] = [];

            public get isPlaying(): boolean { return Tone.Transport.state === "started"; }
            public play(): void { Tone.start(); if (!this.isPlaying) Tone.Transport.start(); }
            public pause(): void { if (this.isPlaying) Tone.Transport.pause(); }
            public stop(): void { Tone.Transport.stop(); }

            public get isLoaded(): boolean {
                if (!this._players.length) return false;
                var loaded: boolean = true;
                for (var i: number = 0; i < this._players.length; i++) {
                    if (!this._players[i].loaded) {
                        loaded = false;
                        break;
                    }
                }
                return loaded;
            }

            public unload(): void {
                this.stop();
                while (this._players.length) this._players.pop().dispose();
                while (this._events.length) Tone.Transport.clear(this._events.pop());
            }

            public load(song: Song): void {
                this.unload();
                Tone.Transport.bpm.value = song.bpm;
                this._secondsPerBeat = new Tone.Time("4n").toSeconds();
                angular.forEach(song.tracks, (track: Track): void => {
                    var player = new Tone.Player(track.audioUrl, (): void => { this.$rootScope.$apply(); });
                    player.sync().start(track.offset).toMaster();
                    player.volume.value = track.volumeNormal;
                    this._players.push(player);
                });
                this._events.push(Tone.Transport.scheduleRepeat((time: number): void => {
                    Tone.Draw.schedule((): void => {
                        this.$rootScope.$apply();
                    }, time);
                }, "4n", song.offset, ((song.endIndex - 2) * this.secondsPerBeat) + song.offset));
                this._events.push(Tone.Transport.scheduleOnce((time: number): void => {
                    Tone.Draw.schedule((): void => {
                        this.stop();
                        this.$rootScope.$apply();
                    }, time);
                }, ((song.endIndex - 1) * this.secondsPerBeat) + song.offset));
            }

            public setVolume(track: Track, volume: IVolume, $event: ng.IAngularEvent): void {
                cancel($event);
                let player = this._players[track.id];
                switch (volume.value) {
                    case "mute": player.mute = true; break;
                    case "normal": player.mute = false; player.volume.value = track.volumeNormal; break;
                    case "boost": player.mute = false; player.volume.value = track.volumeBoost; break;
                }
                track.volume = volume.value;
            }

            private _secondsPerBeat: number;
            public get secondsPerBeat(): number { return this._secondsPerBeat; }
        }
    }
    export interface ISong {
        title: string;
        artist: string;
        imageUrl: string;
        downloadUrl: string;
        bpm: number;
        offset: number;
        tracks: ITrack[];
        sections: ISection[];
    }
    export class Song implements ISong {
        constructor(private _songs: Song[], song: ISong) {
            this._songs.push(this);
            this.title = song.title;
            this.artist = song.artist;
            this.imageUrl = "songs/" + this.id + "/" + song.imageUrl;
            this.downloadUrl = song.downloadUrl || null;
            this.bpm = song.bpm;
            this.offset = song.offset || 0;
            angular.forEach(song.tracks, (track: ITrack): void => { new Track(this.id, this.tracks, track); });
            angular.forEach(song.sections, (section: ISection): void => { new Section(this.sections, section); });
            this.endIndex = this.sections[this.sections.length - 1].startIndex + (this.sections[this.sections.length - 1].bars * 4);
        }
        public get id(): number { return this._songs.indexOf(this); }
        public readonly title: string;
        public readonly artist: string;
        public readonly imageUrl: string;
        public readonly downloadUrl: string;
        public readonly bpm: number;
        public readonly offset: number;
        public readonly tracks: Track[] = [];
        public readonly sections: Section[] = [];
        public readonly endIndex: number;
        public get multitrack(): boolean { return this.tracks.length > 1; }
    }
    export interface ITrack {
        description: string;
        audioUrl: string;
        offset: number;
        volumeNormal: number;
        volumeBoost: number;
    }
    export class Track implements ITrack {
        constructor(songId: number, private _tracks: Track[], track: ITrack) {
            this._tracks.push(this);
            this.description = track.description;
            this.audioUrl = "songs/" + songId + "/" + track.audioUrl;
            this.offset = track.offset || 0;
            this.volumeNormal = track.volumeNormal || -10;
            this.volumeBoost = track.volumeBoost || 0;
            this.volume = "normal";
        }
        public get id(): number { return this._tracks.indexOf(this); }
        public readonly description: string;
        public readonly audioUrl: string;
        public readonly offset: number;
        public readonly volumeNormal: number;
        public readonly volumeBoost: number;
        public volume: Volume;
    }
    export interface ISection {
        description: string;
        structure: string;
        bars: number;
    }
    export class Section implements ISection {
        constructor(private _sections: Section[], section: ISection) {
            _sections.push(this);
            this.description = section.description;
            this.structure = section.structure;
            this.bars = section.bars;
            if (this.id === 0) this.startIndex = 0;
            else {
                let previous: Section = this._sections[this.id - 1];
                this.startIndex = (previous.startIndex || 1) + (previous.bars * 4);
            }
        }
        public get id(): number { return this._sections.indexOf(this); }
        public readonly description: string;
        public readonly structure: string;
        public readonly bars: number;
        public readonly startIndex: number;
        public previous(): Section {
            if (this.id === 0) return;
            return this._sections[this.id - 1];
        }
        public next(): Section {
            if (this.id + 1 >= this._sections.length) return;
            return this._sections[this.id + 1];
        }
    }
    export interface IVolume { value: Volume; faIcon: string; }
    export type Volume = "mute" | "normal" | "boost";
    export const sixteen: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    export function markers(count: number): number[] { return sixteen.slice(0, count); }
    export interface INgClass { [name: string]: boolean; }
    export function cancel($event: ng.IAngularEvent): void {
        if (!$event) return;
        $event.preventDefault();
        $event.stopPropagation();
    }
}

angular.module("emusicality", ["ngRoute", "ngSanitize"])
    .config(eMusicality.config())
    .run(eMusicality.run())
    .service("$emu", eMusicality.Playlist.Service)
    .service("$tone", eMusicality.ToneHandler.Service);