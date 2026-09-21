/*!
 * 蓝调勘景仪 Blue Hour Scout — js/data/db.js
 *
 * IndexedDB 的极薄 Promise 封装。没有后端，所有数据都在本机。
 * 照片以 Blob 存在 photos 库里，不塞进记录本身。
 *
 * 一次性把后面几个阶段要用的库都建好，避免以后做版本迁移。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.DB = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var NAME = 'bluehour';
  var VERSION = 1;

  var STORES = {
    records: { keyPath: 'id', indexes: [['updatedAt', 'updatedAt']] },
    photos: { keyPath: 'id' },
    settings: { keyPath: 'key' },
    calibration: { keyPath: 'id', autoIncrement: true, indexes: [['recordId', 'recordId']] },
    weather: { keyPath: 'key' }
  };

  var dbPromise = null;
  var lastError = null;

  function open() {
    if (dbPromise) { return dbPromise; }
    dbPromise = new Promise(function (resolve, reject) {
      if (!root.indexedDB) {
        reject(new Error('这个浏览器不支持 IndexedDB'));
        return;
      }
      var req;
      try {
        req = indexedDB.open(NAME, VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        Object.keys(STORES).forEach(function (name) {
          if (db.objectStoreNames.contains(name)) { return; }
          var spec = STORES[name];
          var store = db.createObjectStore(name, {
            keyPath: spec.keyPath,
            autoIncrement: !!spec.autoIncrement
          });
          (spec.indexes || []).forEach(function (ix) {
            store.createIndex(ix[0], ix[1], { unique: false });
          });
        });
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { reject(req.error || new Error('IndexedDB 打开失败')); };
      req.onblocked = function () { reject(new Error('IndexedDB 被另一个标签页占用，请关掉其它标签页再试')); };
    });
    dbPromise.catch(function (e) { lastError = e; dbPromise = null; });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var s = t.objectStore(store);
        var out;
        try {
          out = fn(s);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = function () { resolve(out && out.__req ? out.__req.result : out); };
        t.onerror = function () { reject(t.error || new Error('事务失败')); };
        t.onabort = function () { reject(t.error || new Error('事务被中断')); };
      });
    });
  }

  function wrap(req) { return { __req: req }; }

  function get(store, key) {
    return tx(store, 'readonly', function (s) { return wrap(s.get(key)); });
  }

  function getAll(store) {
    return tx(store, 'readonly', function (s) { return wrap(s.getAll()); });
  }

  function getAllByIndex(store, index, value) {
    return tx(store, 'readonly', function (s) {
      return wrap(s.index(index).getAll(value));
    });
  }

  function put(store, value) {
    return tx(store, 'readwrite', function (s) { return wrap(s.put(value)); });
  }

  function putMany(store, values) {
    return tx(store, 'readwrite', function (s) {
      values.forEach(function (v) { s.put(v); });
      return values.length;
    });
  }

  function del(store, key) {
    return tx(store, 'readwrite', function (s) { s.delete(key); return true; });
  }

  function clear(store) {
    return tx(store, 'readwrite', function (s) { s.clear(); return true; });
  }

  function count(store) {
    return tx(store, 'readonly', function (s) { return wrap(s.count()); });
  }

  /** 存储可用性自检，界面启动时调一次，不可用就给出明确提示。 */
  function probe() {
    return open().then(function () { return { ok: true }; })
      .catch(function (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; });
  }

  /** 估算已用空间，设置页显示用。浏览器不支持时返回 null。 */
  function usage() {
    if (!navigator.storage || !navigator.storage.estimate) { return Promise.resolve(null); }
    return navigator.storage.estimate().then(function (e) {
      return { usage: e.usage || 0, quota: e.quota || 0 };
    }).catch(function () { return null; });
  }

  return {
    NAME: NAME,
    VERSION: VERSION,
    STORES: Object.keys(STORES),
    open: open,
    get: get,
    getAll: getAll,
    getAllByIndex: getAllByIndex,
    put: put,
    putMany: putMany,
    del: del,
    clear: clear,
    count: count,
    probe: probe,
    usage: usage,
    lastError: function () { return lastError; }
  };
});
