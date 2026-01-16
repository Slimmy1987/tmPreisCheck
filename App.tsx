
import React, { useState, useMemo, useEffect } from 'react';
import { Supplier, ComparisonData, PriceEntry, ProductMapping, MasterProduct } from './types';
import { extractPricesFromDocument } from './services/geminiService';
import { 
  auth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  syncUserCollection, 
  updateUserFirestore 
} from './services/firebase';

// Komponente für das tmPreisCheck Logo mit optimierten Abständen
const Logo: React.FC<{ light?: boolean }> = ({ light = false }) => (
  <div className="flex items-center select-none scale-90 origin-left">
    <div className={`relative px-4 py-1.5 rounded-2xl flex items-baseline shadow-lg border border-white/10 ${light ? 'bg-slate-100' : 'bg-slate-800'}`}>
      <span className="text-2xl font-black text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)] tracking-tighter italic mr-1">tm</span>
      <span className="text-3xl font-black text-orange-500 drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)] z-10">P</span>
      <span className={`text-2xl font-bold tracking-tight ${light ? 'text-slate-800' : 'text-white'} drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)] -ml-1`}>reisCheck</span>
      {/* Subtile Glanz-Effekte */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/10 to-transparent pointer-events-none"></div>
    </div>
  </div>
);

const App: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [comparisonData, setComparisonData] = useState<ComparisonData>({});
  const [mappings, setMappings] = useState<ProductMapping>({});
  const [masterProducts, setMasterProducts] = useState<MasterProduct[]>([]);
  
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [pendingItems, setPendingItems] = useState<{supplierId: string, items: PriceEntry[]} | null>(null);
  const [editingCanonical, setEditingCanonical] = useState<string | null>(null);
  const [isAddingManual, setIsAddingManual] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  
  // Selection for merging
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [isMerging, setIsMerging] = useState(false);
  const [viewingDetail, setViewingDetail] = useState<string | null>(null);

  // Firebase Auth Listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // Echtzeit-Synchronisierung
  useEffect(() => {
    if (!user) {
      setSuppliers([]);
      setComparisonData({});
      setMappings({});
      setMasterProducts([]);
      return;
    }

    setIsLoading(true);
    const unsubSuppliers = syncUserCollection(user.uid, 'suppliers', (data) => {
      const list = data || [];
      setSuppliers(list);
      if (list.length > 0 && !selectedSupplierId) setSelectedSupplierId(list[0].id);
    });
    
    const unsubPrices = syncUserCollection(user.uid, 'prices', (data) => setComparisonData(data || {}));
    const unsubMappings = syncUserCollection(user.uid, 'mappings', (data) => setMappings(data || {}));
    const unsubMaster = syncUserCollection(user.uid, 'master_products', (data) => {
      setMasterProducts(data || []);
      setIsLoading(false);
    });

    return () => {
      unsubSuppliers();
      unsubPrices();
      unsubMappings();
      unsubMaster();
    };
  }, [user]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedSupplierId || !user) return;
    setIsProcessingFile(true);
    setProcessingProgress(0);
    setError(null);

    const interval = setInterval(() => {
      setProcessingProgress(prev => Math.min(prev + (prev < 50 ? 5 : 1), 95));
    }, 400);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.readAsDataURL(file);
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
      });
      const base64 = await base64Promise;
      const extractedItems = await extractPricesFromDocument(base64, file.type);
      clearInterval(interval);
      setProcessingProgress(100);
      setTimeout(() => {
        setPendingItems({ supplierId: selectedSupplierId, items: extractedItems });
        setIsProcessingFile(false);
      }, 500);
    } catch (err) {
      clearInterval(interval);
      setError("Analyse fehlgeschlagen.");
      setIsProcessingFile(false);
    }
  };

  const finalizeMappings = async (itemMappings: Record<string, string>) => {
    if (!pendingItems || !user) return;
    const { supplierId, items } = pendingItems;
    
    const updatedMaster = [...masterProducts];
    const updatedMappings = { ...mappings };
    const updatedPrices = { ...comparisonData };
    
    updatedPrices[supplierId] = {}; 

    Object.entries(itemMappings).forEach(([supplierProdName, masterNameInput]) => {
      const masterName = masterNameInput || supplierProdName;
      if (!updatedMaster.find(p => p.name === masterName)) {
        updatedMaster.push({ name: masterName, is_favorite: false });
      }
      updatedMappings[`${supplierId}|${supplierProdName}`] = masterName;
      const item = items.find(i => i.product === supplierProdName);
      if (item) {
        updatedPrices[supplierId][supplierProdName] = item.price;
      }
    });

    const updatedSuppliers = suppliers.map(s => 
      s.id === supplierId ? { ...s, lastUpdate: new Date().toLocaleDateString('de-DE') } : s
    );

    await updateUserFirestore(user.uid, 'suppliers', updatedSuppliers);
    await updateUserFirestore(user.uid, 'prices', updatedPrices);
    await updateUserFirestore(user.uid, 'mappings', updatedMappings);
    await updateUserFirestore(user.uid, 'master_products', updatedMaster);
    setPendingItems(null);
  };

  const handleMerge = async (finalName: string) => {
    if (!user || selectedForMerge.size < 2) return;
    
    const nextMappings = { ...mappings };
    const nextMaster = masterProducts.filter(p => !selectedForMerge.has(p.name));
    
    const wasFavorite = masterProducts.some(p => selectedForMerge.has(p.name) && p.is_favorite);
    
    if (!nextMaster.find(p => p.name === finalName)) {
      nextMaster.push({ name: finalName, is_favorite: wasFavorite });
    }

    Object.keys(nextMappings).forEach(key => {
      if (selectedForMerge.has(nextMappings[key])) {
        nextMappings[key] = finalName;
      }
    });

    await updateUserFirestore(user.uid, 'master_products', nextMaster);
    await updateUserFirestore(user.uid, 'mappings', nextMappings);
    
    setSelectedForMerge(new Set());
    setIsMerging(false);
  };

  const toggleSelection = (name: string) => {
    const next = new Set(selectedForMerge);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedForMerge(next);
  };

  const addSupplier = async () => {
    if (!newSupplierName.trim() || !user) return;
    const next = [...suppliers, { id: crypto.randomUUID(), name: newSupplierName.trim(), lastUpdate: "" }];
    await updateUserFirestore(user.uid, 'suppliers', next);
    setNewSupplierName('');
  };

  const deleteSupplier = async (id: string) => {
    if (!confirm("Wirklich löschen?") || !user) return;
    const nextSuppliers = suppliers.filter(s => s.id !== id);
    const nextPrices = { ...comparisonData }; delete nextPrices[id];
    const nextMappings = { ...mappings };
    Object.keys(nextMappings).forEach(k => { if (k.startsWith(`${id}|`)) delete nextMappings[k]; });
    
    await updateUserFirestore(user.uid, 'suppliers', nextSuppliers);
    await updateUserFirestore(user.uid, 'prices', nextPrices);
    await updateUserFirestore(user.uid, 'mappings', nextMappings);
  };

  const getCanonicalPrice = (supplierId: string, canonicalName: string) => {
    const supplierPrices = comparisonData[supplierId];
    if (!supplierPrices) return null;
    const mappingKey = Object.keys(mappings).find(k => k.startsWith(`${supplierId}|`) && mappings[k] === canonicalName);
    if (!mappingKey) return null;
    const supplierProductName = mappingKey.split('|')[1];
    return supplierPrices[supplierProductName] ?? null;
  };

  const filteredAndSortedProducts = useMemo(() => {
    return masterProducts
      .filter(p => p.name && p.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => (a.is_favorite === b.is_favorite ? a.name.localeCompare(b.name) : a.is_favorite ? -1 : 1));
  }, [masterProducts, searchQuery]);

  // Checkbox Styling Classes
  const checkboxClasses = "w-6 h-6 border-2 border-slate-300 rounded bg-white checked:bg-orange-600 checked:border-orange-600 cursor-pointer transition-all appearance-none relative after:content-[''] after:absolute after:hidden checked:after:block after:left-[7px] after:top-[2px] after:w-[6px] after:h-[12px] after:border-white after:border-b-2 after:border-r-2 after:rotate-45";

  if (authLoading) return <div className="h-screen flex items-center justify-center bg-slate-900 text-white"><i className="fas fa-circle-notch fa-spin text-4xl text-orange-500"></i></div>;
  if (!user) return <AuthScreen />;

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-50 print:bg-white">
      <aside className="w-full md:w-80 bg-slate-900 text-white p-6 shadow-xl z-10 flex flex-col h-screen sticky top-0 overflow-y-auto no-print">
        <div className="flex items-center justify-between mb-10 shrink-0">
          <Logo />
          <button onClick={() => signOut(auth)} className="text-slate-500 hover:text-red-400 transition-colors" title="Abmelden"><i className="fas fa-sign-out-alt"></i></button>
        </div>

        <div className="flex-1 space-y-8">
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Lieferanten</h2>
            <div className="space-y-2">
              {suppliers.map(s => (
                <div key={s.id} className="group relative">
                  <button onClick={() => setSelectedSupplierId(s.id)} className={`w-full text-left px-4 py-3 rounded-xl transition-all ${selectedSupplierId === s.id ? 'bg-orange-600 text-white shadow-lg' : 'hover:bg-slate-800 text-slate-300'}`}>
                    <span className="font-medium truncate block">{s.name}</span>
                    {s.lastUpdate && <span className="text-[10px] opacity-70">Liste vom: {s.lastUpdate}</span>}
                  </button>
                  <button onClick={() => deleteSupplier(s.id)} className="absolute right-2 top-4 opacity-0 group-hover:opacity-100 p-1 hover:text-red-400"><i className="fas fa-trash text-xs"></i></button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <input type="text" placeholder="Neu..." className="bg-white border-none text-slate-800 text-sm rounded-lg px-3 py-2 flex-1 outline-none focus:ring-1 focus:ring-orange-500 placeholder:text-slate-400 shadow-inner" value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSupplier()} />
              <button onClick={addSupplier} className="bg-slate-700 hover:bg-orange-600 px-3 py-2 rounded-lg"><i className="fas fa-plus"></i></button>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-800 space-y-4">
            <button onClick={() => setIsAddingManual(true)} className="w-full bg-slate-800 hover:bg-slate-700 text-sm font-bold py-3 rounded-xl border border-slate-700 flex items-center justify-center gap-2">
              <i className="fas fa-plus-circle text-orange-400"></i> Einzelner Artikel
            </button>
            <div className="relative">
              <input type="file" accept="application/pdf,image/*" onChange={handleFileUpload} disabled={isProcessingFile || !selectedSupplierId} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              <div className="flex flex-col items-center justify-center gap-2 w-full py-4 px-4 rounded-xl border-2 border-dashed border-slate-700 hover:border-orange-500 hover:bg-slate-800 transition-all">
                <div className="flex items-center gap-2">
                  {isProcessingFile ? <i className="fas fa-spinner fa-spin text-orange-400"></i> : <i className="fas fa-file-invoice-dollar text-slate-500"></i>}
                  <span className="text-sm font-bold">{isProcessingFile ? `Analysiere... ${Math.round(processingProgress)}%` : 'Liste aktualisieren (KI)'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-auto pt-4 text-[10px] text-slate-500 truncate">Konto: {user.email}</div>
      </aside>

      <main className="flex-1 p-4 md:p-10 overflow-auto">
        <header className="mb-10 space-y-6 print:hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div><h2 className="text-3xl font-extrabold text-slate-800">Preisvergleich</h2><p className="text-slate-500">Ihre gespeicherten Listen & Verknüpfungen.</p></div>
              {selectedForMerge.size >= 2 && (
                <button onClick={() => setIsMerging(true)} className="bg-orange-600 text-white px-6 py-3 rounded-2xl font-black shadow-xl animate-bounce flex items-center gap-2">
                  <i className="fas fa-object-group"></i> Artikel verbinden ({selectedForMerge.size})
                </button>
              )}
            </div>
            <div className="flex flex-1 max-w-md items-center bg-white border rounded-2xl px-5 py-3 shadow-sm focus-within:ring-2 focus-within:ring-orange-500">
              <i className="fas fa-search text-slate-400 mr-4"></i>
              <input type="text" placeholder="Master-Artikel suchen..." className="w-full outline-none font-semibold bg-white text-slate-800" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <button onClick={() => window.print()} className="bg-white border text-slate-700 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50 transition-all"><i className="fas fa-print"></i> PDF Export</button>
          </div>
        </header>

        {isLoading ? <div className="text-center py-20"><i className="fas fa-spinner fa-spin text-4xl text-orange-500"></i></div> : (
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden print:shadow-none border border-slate-100">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-6 py-5 w-12 no-print">
                      <input 
                        type="checkbox" 
                        checked={selectedForMerge.size === filteredAndSortedProducts.length && filteredAndSortedProducts.length > 0} 
                        onChange={(e) => {
                          if (e.target.checked) setSelectedForMerge(new Set(filteredAndSortedProducts.map(p => p.name)));
                          else setSelectedForMerge(new Set());
                        }} 
                        className={checkboxClasses}
                      />
                    </th>
                    <th className="px-4 py-5 text-[11px] font-bold text-slate-400 uppercase tracking-widest min-w-[300px]">Master-Bezeichnung</th>
                    {suppliers.map(s => <th key={s.id} className="px-8 py-5 text-[11px] font-bold text-slate-400 uppercase tracking-widest text-right">{s.name}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredAndSortedProducts.length === 0 ? (
                    <tr><td colSpan={suppliers.length + 2} className="p-20 text-center text-slate-400 font-medium">Keine Artikel gefunden.</td></tr>
                  ) : filteredAndSortedProducts.map(p => {
                    const prices = suppliers.map(s => getCanonicalPrice(s.id, p.name)).filter(x => x !== null) as number[];
                    const minPrice = prices.length > 0 ? Math.min(...prices) : null;
                    const isSelected = selectedForMerge.has(p.name);
                    return (
                      <tr key={p.name} className={`hover:bg-slate-50 transition-colors group ${p.is_favorite ? 'bg-amber-50/20' : ''} ${isSelected ? 'bg-orange-50' : ''}`}>
                        <td className="px-6 py-5 no-print">
                          <input 
                            type="checkbox" 
                            checked={isSelected} 
                            onChange={() => toggleSelection(p.name)} 
                            className={checkboxClasses}
                          />
                        </td>
                        <td className="px-4 py-5 font-bold">
                          <div className="flex items-center gap-3">
                            <button onClick={() => updateUserFirestore(user.uid, 'master_products', masterProducts.map(m => m.name === p.name ? {...m, is_favorite: !p.is_favorite} : m))} className={`${p.is_favorite ? 'text-amber-400' : 'text-slate-200'} transition-colors no-print`}><i className="fas fa-star"></i></button>
                            <div className="flex flex-col">
                              <button onClick={() => setViewingDetail(p.name)} className="text-left hover:text-orange-600 transition-colors">
                                {p.name}
                              </button>
                              <div className="flex gap-2 no-print">
                                <button onClick={() => setEditingCanonical(p.name)} className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 hover:text-orange-500 transition-opacity">Zuweisung</button>
                                <button onClick={() => setViewingDetail(p.name)} className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 hover:text-orange-500 transition-opacity">Details</button>
                              </div>
                            </div>
                          </div>
                        </td>
                        {suppliers.map(s => {
                          const price = getCanonicalPrice(s.id, p.name);
                          const isBest = price !== null && price === minPrice;
                          return <td key={s.id} className="px-8 py-5 text-right">{price !== null ? <span className={`inline-flex px-3 py-1 rounded-xl text-sm font-bold ${isBest ? 'bg-green-500 text-white shadow-sm' : 'bg-slate-50 text-slate-600'}`}>{price.toLocaleString('de-DE', {style:'currency', currency:'EUR'})}</span> : <span className="text-slate-200">—</span>}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      {isMerging && <MergeModal options={Array.from(selectedForMerge)} onCancel={() => setIsMerging(false)} onConfirm={handleMerge} />}
      
      {viewingDetail && <ProductDetailModal 
        masterName={viewingDetail} 
        suppliers={suppliers} 
        mappings={mappings} 
        comparisonData={comparisonData} 
        onClose={() => setViewingDetail(null)} 
      />}

      {isAddingManual && <ManualEntryModal masterProducts={masterProducts} onCancel={() => setIsAddingManual(false)} onConfirm={async (m: string, s: string, p: number) => {
        const upMaster = [...masterProducts]; if (!upMaster.find(x => x.name === m)) upMaster.push({ name: m, is_favorite: false });
        const upPrices = { ...comparisonData }; if (!upPrices[selectedSupplierId]) upPrices[selectedSupplierId] = {}; 
        upPrices[selectedSupplierId][s] = p;
        const upMappings = { ...mappings }; upMappings[`${selectedSupplierId}|${s}`] = m;
        await updateUserFirestore(user.uid, 'master_products', upMaster);
        await updateUserFirestore(user.uid, 'prices', upPrices);
        await updateUserFirestore(user.uid, 'mappings', upMappings);
        setIsAddingManual(false);
      }} />}
      
      {pendingItems && <MappingReviewModal pendingItems={pendingItems} suppliers={suppliers} canonicalProducts={masterProducts.map(p => p.name)} mappings={mappings} onCancel={() => setPendingItems(null)} onConfirm={finalizeMappings} />}
      
      {editingCanonical && <ManualEditModal productName={editingCanonical} suppliers={suppliers} comparisonData={comparisonData} mappings={mappings} onCancel={() => setEditingCanonical(null)} onConfirm={async (newMap: any) => { await updateUserFirestore(user.uid, 'mappings', newMap); setEditingCanonical(null); }} />}
    </div>
  );
};

const AuthScreen = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isLogin) await signInWithEmailAndPassword(auth, email, password);
      else await createUserWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      setError("Fehler: Login fehlgeschlagen.");
    } finally { setLoading(false); }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-slate-900 p-4">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md p-10 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-2 bg-orange-600"></div>
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Logo light />
          </div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">tmPreisCheck</h2>
          <p className="text-slate-500 font-medium">Privater Cloud-Bereich.</p>
        </div>
        <form onSubmit={handleAuth} className="space-y-4">
          <input type="email" placeholder="Email" required className="w-full bg-slate-50 border-none p-4 rounded-2xl outline-none focus:ring-2 focus:ring-orange-500 font-semibold" value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" placeholder="Passwort" required className="w-full bg-slate-50 border-none p-4 rounded-2xl outline-none focus:ring-2 focus:ring-orange-500 font-semibold" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <p className="text-red-500 text-xs font-bold text-center">{error}</p>}
          <button disabled={loading} className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black shadow-lg">
            {loading ? <i className="fas fa-spinner fa-spin"></i> : (isLogin ? 'Anmelden' : 'Registrieren')}
          </button>
        </form>
        <button onClick={() => setIsLogin(!isLogin)} className="w-full mt-6 text-slate-400 text-sm font-bold">
          {isLogin ? 'Konto erstellen' : 'Zum Login'}
        </button>
      </div>
    </div>
  );
};

const MergeModal: React.FC<any> = ({ options, onCancel, onConfirm }) => {
  const [name, setName] = useState(options[0]);
  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] p-10 w-full max-w-lg shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-orange-100 text-orange-600 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-object-group text-3xl"></i>
          </div>
          <h3 className="text-2xl font-black text-slate-800">Artikel zusammenführen</h3>
          <p className="text-slate-500">Wählen Sie den finalen Master-Namen.</p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase ml-2">Finaler Name</label>
            <input list="merge-opts" className="w-full bg-slate-50 border-none p-4 rounded-2xl outline-none focus:ring-2 focus:ring-orange-500 font-bold" value={name} onChange={e => setName(e.target.value)} />
            <datalist id="merge-opts">{options.map((o:string) => <option key={o} value={o}/>)}</datalist>
          </div>
          <div className="p-4 bg-orange-50 rounded-2xl border border-orange-100">
            <h4 className="text-[10px] font-bold text-orange-600 uppercase mb-2">Betroffene Artikel:</h4>
            <ul className="text-xs space-y-1 text-slate-600 font-medium">
              {options.map((o:string) => <li key={o} className="flex items-center gap-2"><i className="fas fa-check text-[10px]"></i> {o}</li>)}
            </ul>
          </div>
        </div>
        <div className="mt-10 flex gap-4">
          <button onClick={onCancel} className="flex-1 font-bold text-slate-400">Abbrechen</button>
          <button onClick={() => onConfirm(name)} className="flex-[2] bg-slate-900 text-white py-4 rounded-2xl font-black shadow-xl transform active:scale-95 transition-all">Verbinden</button>
        </div>
      </div>
    </div>
  );
};

const ProductDetailModal: React.FC<any> = ({ masterName, suppliers, mappings, comparisonData, onClose }) => {
  const descriptionMap = useMemo(() => {
    const res: Record<string, string[]> = {};
    Object.keys(mappings).forEach(key => {
      if (mappings[key] === masterName) {
        const [supplierId, prodName] = key.split('|');
        const supplier = suppliers.find((s:any) => s.id === supplierId);
        if (supplier) {
          if (!res[supplier.name]) res[supplier.name] = [];
          res[supplier.name].push(prodName);
        }
      }
    });
    return res;
  }, [masterName, mappings, suppliers]);

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-xl shadow-2xl overflow-hidden">
        <div className="p-8 border-b bg-slate-50 flex justify-between items-center">
          <div>
            <h3 className="text-2xl font-black text-slate-800">{masterName}</h3>
            <p className="text-sm text-slate-500 font-medium">Lieferanten-Bezeichnungen im Detail</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><i className="fas fa-times text-xl"></i></button>
        </div>
        <div className="p-8 space-y-6 max-h-[60vh] overflow-y-auto">
          {Object.keys(descriptionMap).length === 0 ? (
            <p className="text-center text-slate-400 py-10">Keine Lieferanten-Verknüpfungen gefunden.</p>
          ) : Object.entries(descriptionMap).map(([sName, items]) => (
            <div key={sName} className="space-y-3">
              <h4 className="text-[10px] font-black text-orange-600 uppercase tracking-widest">{sName}</h4>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="bg-slate-50 p-4 rounded-2xl flex justify-between items-center border border-slate-100">
                    <span className="font-bold text-slate-700">{item}</span>
                    <span className="text-orange-500 font-black">
                      {(comparisonData[suppliers.find((s:any)=>s.name===sName)?.id || ""]?.[item])?.toLocaleString('de-DE', {style:'currency', currency:'EUR'})}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="p-8 border-t bg-slate-50 text-center">
          <button onClick={onClose} className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-black shadow-lg">Schließen</button>
        </div>
      </div>
    </div>
  );
};

const ManualEntryModal: React.FC<any> = ({ masterProducts, onCancel, onConfirm }) => {
  const [m, setM] = useState(''); const [s, setS] = useState(''); const [p, setP] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl">
        <h3 className="text-xl font-bold mb-6">Artikel hinzufügen</h3>
        <div className="space-y-4">
          <input list="m" placeholder="Master-Name" className="w-full bg-slate-50 p-4 rounded-xl outline-none" value={m} onChange={e=>setM(e.target.value)} />
          <datalist id="m">{masterProducts.map((x:any)=><option key={x.name} value={x.name}/>)}</datalist>
          <input placeholder="Lieferanten-Name" className="w-full bg-slate-50 p-4 rounded-xl outline-none" value={s} onChange={e=>setS(e.target.value)} />
          <input type="number" step="0.01" placeholder="Preis (€)" className="w-full bg-slate-50 p-4 rounded-xl font-bold text-lg outline-none" value={p} onChange={e=>setP(e.target.value)} />
        </div>
        <div className="mt-8 flex gap-4">
          <button onClick={onCancel} className="flex-1 text-slate-400 font-bold">Abbrechen</button>
          <button onClick={()=>onConfirm(m, s||m, parseFloat(p))} className="flex-[2] bg-orange-600 text-white py-4 rounded-xl font-bold shadow-lg">Speichern</button>
        </div>
      </div>
    </div>
  );
};

const MappingReviewModal: React.FC<any> = ({ pendingItems, suppliers, canonicalProducts, mappings, onCancel, onConfirm }) => {
  const [lm, setLm] = useState<any>(() => {
    const init: any = {};
    pendingItems.items.forEach((i: any) => { 
      init[i.product] = mappings[`${pendingItems.supplierId}|${i.product}`] || ""; 
    });
    return init;
  });
  const supplier = suppliers.find((s:any) => s.id === pendingItems.supplierId);
  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="p-8 border-b bg-slate-50/50 flex justify-between items-center">
          <div><h2 className="text-2xl font-black text-slate-800">KI-Review: {supplier?.name}</h2></div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><i className="fas fa-times text-xl"></i></button>
        </div>
        <div className="flex-1 overflow-y-auto p-8 space-y-3">
          {pendingItems.items.map((i: any, idx: number) => (
            <div key={idx} className="grid grid-cols-12 items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="col-span-5 font-bold truncate text-slate-700" title={i.product}>{i.product}</div>
              <div className="col-span-2 text-right font-black text-orange-600">{i.price.toLocaleString('de-DE', {style:'currency', currency:'EUR'})}</div>
              <div className="col-span-5">
                <select className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold text-sm outline-none" value={lm[i.product]} onChange={e => setLm({...lm, [i.product]: e.target.value})}>
                  <option value="">+ Als neuen Master-Artikel anlegen</option>
                  {canonicalProducts.map((p:string) => <option key={p} value={p}>Zuweisen zu: {p}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
        <div className="p-8 border-t flex justify-end gap-4 bg-white">
          <button onClick={onCancel} className="text-slate-400 font-bold px-6 py-3">Abbrechen</button>
          <button onClick={() => onConfirm(lm)} className="bg-slate-900 text-white px-10 py-3 rounded-xl font-black shadow-xl">Liste speichern</button>
        </div>
      </div>
    </div>
  );
};

const ManualEditModal: React.FC<any> = ({ productName, suppliers, comparisonData, mappings, onCancel, onConfirm }) => {
  const [cm, setCm] = useState<any>({ ...mappings });
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] w-full max-w-lg p-10 shadow-2xl">
        <h3 className="text-xl font-black mb-8">Zuweisung: {productName}</h3>
        <div className="space-y-6">
          {suppliers.map((s:any) => {
            const mapped = Object.keys(cm).find(k => k.startsWith(`${s.id}|`) && cm[k] === productName)?.split('|')[1];
            return (
              <div key={s.id} className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">{s.name}</label>
                <select className="w-full bg-slate-50 border p-4 rounded-xl font-bold outline-none" value={mapped || ""} onChange={e => {
                   const next = {...cm};
                   const old = Object.keys(next).find(k => k.startsWith(`${s.id}|`) && next[k] === productName);
                   if (old) delete next[old];
                   if (e.target.value) next[`${s.id}|${e.target.value}`] = productName;
                   setCm(next);
                }}>
                  <option value="">Keine Verknüpfung</option>
                  {Object.keys(comparisonData[s.id] || {}).map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            );
          })}
        </div>
        <div className="mt-10 flex gap-4"><button onClick={onCancel} className="flex-1 font-bold text-slate-400">Abbrechen</button><button onClick={()=>onConfirm(cm)} className="flex-1 bg-slate-900 text-white py-4 rounded-xl font-black">Speichern</button></div>
      </div>
    </div>
  );
};

export default App;
