import { Plugin } from 'obsidian';
import { noteContent } from '../../src/pureref/notes';
import { openPureRef, externalAppInfo } from '../../src/pureref/open';

/** Only installed by the opt-in desktop smoke test, never part of a release. */
export default class PureRefTestProbe extends Plugin {
	noteContent = noteContent;
	openPureRef = openPureRef;
	externalAppInfo = externalAppInfo;
}
