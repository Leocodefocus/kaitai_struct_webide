﻿import * as localforage from "localforage";

import { ga, app } from "./app";
import { IJSTreeNode } from "./parsedToTree";
import { downloadFile, saveFile, openFilesWithDialog } from "./utils";
declare var kaitaiFsFiles: string[];

interface IFileSystem {
    getRootNode(): Promise<any>;
    get(fn: string): Promise<string | ArrayBuffer>;
    put(fn: string, data: any): Promise<IFsItem>;
}

/* tslint:disable */
export interface IFsItem {
    fsType: string;
    type: "file" | "folder";
    fn?: string;
    children?: { [key: string]: IFsItem; };
}
/* tslint:enable */

var fsHelper = {
    selectNode(root: IFsItem, fn: string) {
        var currNode = root;
        var fnParts = fn.split("/");
        var currPath = "";
        for (var i = 0; i < fnParts.length; i++) {
            var fnPart = fnParts[i];
            currPath += (currPath ? "/" : "") + fnPart;

            if (!("children" in currNode)) {
                currNode.children = {};
                currNode.type = "folder";
            }

            if (!(fnPart in currNode.children))
                currNode.children[fnPart] = { fsType: root.fsType, type: "file", fn: currPath };

            currNode = currNode.children[fnPart];
        }
        return currNode;
    }
};

class LocalStorageFs implements IFileSystem {
    constructor(public prefix: string) { }

    private root: IFsItem;
    private rootPromise: Promise<IFsItem>;
    private filesKey() { return `${this.prefix}_files`; }
    private fileKey(fn: string) { return `${this.prefix}_file[${fn}]`; }

    private save() { return localforage.setItem(this.filesKey(), this.root); }

    getRootNode() {
        if (this.root)
            return Promise.resolve(this.root);
        this.rootPromise = localforage.getItem<IFsItem>(this.filesKey())
            .then(x => x || <IFsItem>{ fsType: "local", type: "folder", children: {} }).then(r => this.root = r);
        return this.rootPromise;
    }

    setRootNode(newRoot: IFsItem) {
        this.root = newRoot;
        return this.save();
    }

    get(fn: string): Promise<string | ArrayBuffer> { return localforage.getItem<string|ArrayBuffer>(this.fileKey(fn)); }

    put(fn: string, data: any): Promise<IFsItem> {
        return this.getRootNode().then(root => {
            var node = fsHelper.selectNode(root, fn);
            return Promise.all([localforage.setItem(this.fileKey(fn), data), this.save()]).then(x => node);
        });
    }
}

class KaitaiFs implements IFileSystem {
    constructor(public files: any) { }

    getRootNode() { return Promise.resolve(this.files); }

    get(fn: string): Promise<string|ArrayBuffer> {
        if (fn.toLowerCase().endsWith(".ksy"))
            return Promise.resolve<string>($.ajax({ url: fn }));
        else
            return downloadFile(fn);
    }

    put(fn: string, data: any) { return Promise.reject("KaitaiFs.put is not implemented!"); }
}

class StaticFs implements IFileSystem {
    public files: { [fn: string]:string };
    constructor() { this.files = {}; }
    getRootNode() { return Promise.resolve(Object.keys(this.files).map(fn => <IFsItem>{ fsType: "static", type: "file", fn })); }
    get(fn: string) { return Promise.resolve(this.files[fn]); }
    put(fn: string, data: any) { this.files[fn] = data; return Promise.resolve(null); }
}

var kaitaiRoot = <IFsItem>{ fsType: "kaitai" };
kaitaiFsFiles.forEach(fn => fsHelper.selectNode(kaitaiRoot, fn));
var kaitaiFs = new KaitaiFs(kaitaiRoot);
var staticFs = new StaticFs();

var localFs = new LocalStorageFs("fs");
/* tslint:disable */
export var fss: {
    [name: string]: IFileSystem;
    local: LocalStorageFs;
    kaitai: KaitaiFs;
    static: StaticFs;
} = { local: localFs, kaitai: kaitaiFs, static: staticFs };
/* tslint:enable */

function genChildNode(obj: IFsItem, fn: string): any {
    var isFolder = obj.type === "folder";
    return {
        text: fn,
        icon: "glyphicon glyphicon-" + (isFolder ? "folder-open" : fn.endsWith(".ksy") ? "list-alt" : "file"),
        children: isFolder ? genChildNodes(obj) : null,
        data: obj
    };
}

function genChildNodes(obj: IFsItem): any {
    return Object.keys(obj.children || []).map(k => genChildNode(obj.children[k], k));
}

export function refreshFsNodes() {
    var localStorageNode = app.ui.fileTree.get_node("localStorage");
    return localFs.getRootNode().then(root => {
        app.ui.fileTree.delete_node(localStorageNode.children);
        if (root)
            genChildNodes(root).forEach((node: any) => app.ui.fileTree.create_node(localStorageNode, node));
    });
}

export function addKsyFile(parent: string | Element, ksyFn: string, content: string) {
    var name = ksyFn.split("/").last();
    return fss.local.put(name, content).then((fsItem: IFsItem) => {
        app.ui.fileTree.create_node(app.ui.fileTree.get_node(parent), { text: name, data: fsItem, icon: "glyphicon glyphicon-list-alt" },
            "last", (node: any) => app.ui.fileTree.activate_node(node, null));
        return app.loadFsItem(fsItem, true);
    });
}

var fileTreeCont: JQuery;

export function initFileTree() {
    fileTreeCont = app.ui.fileTreeCont.find(".fileTree");

    app.ui.fileTree = fileTreeCont.jstree({
        core: {
            check_callback: function (operation: string, node: any, node_parent: any, node_position: number, more: boolean) {
                var result = true;
                if (operation === "move_node")
                    result = !!node.data && node.data.fsType === "local" &&
                        !!node_parent.data && node_parent.data.fsType === "local" && node_parent.data.type === "folder";
                return result;
            },
            themes: { name: "default-dark", dots: false, icons: true, variant: "small" },
            data: [
                {
                    text: "kaitai.io",
                    icon: "glyphicon glyphicon-cloud",
                    state: { opened: true },
                    children: [
                        {
                            text: "formats",
                            icon: "glyphicon glyphicon-book",
                            children: genChildNodes(kaitaiRoot.children["formats"]),
                            state: { opened: true }
                        },
                        {
                            text: "samples",
                            icon: "glyphicon glyphicon-cd",
                            children: genChildNodes(kaitaiRoot.children["samples"]),
                            state: { opened: true }
                        },
                    ]
                },
                {
                    text: "Local storage",
                    id: "localStorage",
                    icon: "glyphicon glyphicon-hdd",
                    state: { opened: true },
                    children: [],
                    data: { fsType: "local", type: "folder" }
                }
            ],
        },
        plugins: ["wholerow", "dnd"]
    }).bind("loaded.jstree", refreshFsNodes).jstree(true);

    var uiFiles = {
        fileTreeContextMenu: $("#fileTreeContextMenu"),
        openItem: $("#fileTreeContextMenu .openItem"),
        createFolder: $("#fileTreeContextMenu .createFolder"),
        createKsyFile: $("#fileTreeContextMenu .createKsyFile"),
        cloneKsyFile: $("#fileTreeContextMenu .cloneKsyFile"),
        generateParser: $("#fileTreeContextMenu .generateParser"),
        downloadItem: $("#fileTreeContextMenu .downloadItem"),
        deleteItem: $("#fileTreeContextMenu .deleteItem"),
        createLocalKsyFile: $("#createLocalKsyFile"),
        uploadFile: $("#uploadFile"),
        downloadFile: $("#downloadFile"),
    };

    function convertTreeNode(treeNode: any) {
        var data = treeNode.data;
        data.children = {};
        treeNode.children.forEach((child: any) => data.children[child.text] = convertTreeNode(child));
        return data;
    }

    function saveTree() {
        localFs.setRootNode(convertTreeNode(app.ui.fileTree.get_json()[1]));
    }

    var contextMenuTarget: string|Element = null;

    function getSelectedData() {
        var selected = app.ui.fileTree.get_selected();
        return selected.length >= 1 ? <IFsItem>app.ui.fileTree.get_node(selected[0]).data : null;
    }

    fileTreeCont.on("contextmenu", ".jstree-node", e => {
        contextMenuTarget = e.target;

        var clickNodeId = app.ui.fileTree.get_node(contextMenuTarget).id;
        var selectedNodeIds = app.ui.fileTree.get_selected();
        if ($.inArray(clickNodeId, selectedNodeIds) === -1)
            app.ui.fileTree.activate_node(contextMenuTarget, null);

        var data = getSelectedData();
        var isFolder = data && data.type === "folder";
        var isLocal = data && data.fsType === "local";
        var isKsy = data && data.fn && data.fn.endsWith(".ksy") && !isFolder;

        function setEnabled(item: JQuery, isEnabled: boolean) { item.toggleClass("disabled", !isEnabled); }

        setEnabled(uiFiles.createFolder, isLocal && isFolder);
        setEnabled(uiFiles.createKsyFile, isLocal && isFolder);
        setEnabled(uiFiles.cloneKsyFile, isLocal && isKsy);
        setEnabled(uiFiles.deleteItem, isLocal);
        setEnabled(uiFiles.generateParser, isKsy);
        uiFiles.fileTreeContextMenu.css({ display: "block", left: e.pageX, top: e.pageY });
        return false;
    });

    function ctxAction(obj: JQuery, callback: (e: JQueryEventObject) => void) {
        obj.find("a").on("click", e => {
            if (!obj.hasClass("disabled")) {
                uiFiles.fileTreeContextMenu.hide();
                callback(e);
            }
        });
    }

    ctxAction(uiFiles.createFolder, e => {
        var parentData = getSelectedData();
        app.ui.fileTree.create_node(app.ui.fileTree.get_node(contextMenuTarget), {
            data: { fsType: parentData.fsType, type: "folder" },
            icon: "glyphicon glyphicon-folder-open"
        }, "last", (node: any) => {
            app.ui.fileTree.activate_node(node, null);
            setTimeout(function () { app.ui.fileTree.edit(node); }, 0);
        });
    });

    ctxAction(uiFiles.deleteItem, () => app.ui.fileTree.delete_node(app.ui.fileTree.get_selected()));
    ctxAction(uiFiles.openItem, () => $(contextMenuTarget).trigger("dblclick"));

    ctxAction(uiFiles.generateParser, e => {
        var fsItem = getSelectedData();
        var linkData = $(e.target).data();
        //console.log(fsItem, linkData);

        fss[fsItem.fsType].get(fsItem.fn).then((content: string) => {
            return this.compile(content, linkData.kslang, !!linkData.ksdebug).then((compiled: any) => {
                Object.keys(compiled).forEach(fileName => {
                    //var title = fsItem.fn.split("/").last() + " [" + $(e.target).text() + "]" + (compiled.length == 1 ? "" : ` ${i + 1}/${compiled.length}`);
                    //addEditorTab(title, compItem, linkData.acelang);

                    app.ui.layout.addEditorTab(fileName, compiled[fileName], linkData.acelang);
                });
            });
        });
    });

    fileTreeCont.on("rename_node.jstree", () => ga("filetree", "rename"));
    fileTreeCont.on("move_node.jstree", () => ga("filetree", "move"));

    fileTreeCont.on("create_node.jstree rename_node.jstree delete_node.jstree move_node.jstree paste.jstree", saveTree);
    fileTreeCont.on("move_node.jstree", (e, data) => app.ui.fileTree.open_node(app.ui.fileTree.get_node(data.parent)));
    fileTreeCont.on("select_node.jstree", (e, selectNodeArgs) => {
        var fsItem = (<IJSTreeNode<IFsItem>>selectNodeArgs.node).data;
        [uiFiles.downloadFile, uiFiles.downloadItem].forEach(i => i.toggleClass("disabled", !(fsItem && fsItem.type === "file")));
    });

    var lastMultiSelectReport = 0;
    fileTreeCont.on("select_node.jstree", (e, args) => {
        if (e.timeStamp - lastMultiSelectReport > 1000 && args.selected.length > 1)
            ga("filetree", "multi_select");
        lastMultiSelectReport = e.timeStamp;
    });

    var ksyParent: string|Element;
    function showKsyModal(parent: string | Element) {
        ksyParent = parent;
        $("#newKsyName").val("");
        (<any>$("#newKsyModal")).modal();
    }

    ctxAction(uiFiles.createKsyFile, () => showKsyModal(contextMenuTarget));
    uiFiles.createLocalKsyFile.on("click", () => showKsyModal("localStorage"));

    function downloadFiles() {
        app.ui.fileTree.get_selected().forEach(nodeId => {
            var fsItem = <IFsItem>app.ui.fileTree.get_node(nodeId).data;
            fss[fsItem.fsType].get(fsItem.fn).then(content => saveFile(content, fsItem.fn.split("/").last()));
        });
    }

    ctxAction(uiFiles.downloadItem, () => downloadFiles());
    uiFiles.downloadFile.on("click", () => downloadFiles());

    uiFiles.uploadFile.on("click", () => openFilesWithDialog(app.addNewFiles));

    $("#newKsyModal").on("shown.bs.modal", () => { $("#newKsyModal input").focus(); });
    $("#newKsyModal form").submit(function (event) {
        event.preventDefault();
        (<any>$("#newKsyModal")).modal("hide");

        var ksyName = $("#newKsyName").val();
        var parentData = app.ui.fileTree.get_node(ksyParent).data;

        addKsyFile(ksyParent, (parentData.fn ? `${parentData.fn}/` : "") + `${ksyName}.ksy`, `meta:\n  id: ${ksyName}\n  file-extension: ${ksyName}\n`);
    });

    fileTreeCont.bind("dblclick.jstree", function (event) {
        app.loadFsItem(<IFsItem>app.ui.fileTree.get_node(event.target).data);
    });

    ctxAction(uiFiles.cloneKsyFile, e => {
        var fsItem = getSelectedData();
        var newFn = fsItem.fn.replace(".ksy", "_" + new Date().format("Ymd_His") + ".ksy");
        console.log("newFn", newFn);

        fss[fsItem.fsType].get(fsItem.fn).then((content: string) => addKsyFile("localStorage", newFn, content));
    });
}