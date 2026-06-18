  import { Suspense, useEffect, useState, useRef, useCallback, useContext, createContext, useMemo} from 'react';
import Map from 'react-map-gl/mapbox';
import axios from 'axios';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import DeckGL, { PolygonLayer, TextLayer } from 'deck.gl';
import {H3ClusterLayer} from '@deck.gl/geo-layers';
import { ColumnLayer } from '@deck.gl/layers';
import { getTownClusters } from './Components/Backend/Database_connections';
import 'mapbox-gl/dist/mapbox-gl.css';
import './Stylesheets/main.css';
import mData from './Datasets/MaltaRegionsPolygons/MaltaGeoJSON.geojson';
import townPolygons from './Datasets/MaltaRegionsPolygons/TownPolygonInfo.json';
import tData from './Datasets/MaltaDistricts.Json';
import FilterSelection from './Components/Filters/FilterSelection';
import TownOverview from './Components/TownOverview';
import StatisticsDashboard from './StatisticsDashboard';
import { emphasize } from '@mui/material/styles';
import { townsCoordinates } from './Datasets/TownCoordinates';
import { PollutionLevelColorGrade, WHOThresholds, pollutantDBKeyMap } from './Components/Backend/PollutionInfo.js';
import  Legend  from './Components/Legend.js';
import PollutionMap from './Components/Layers/PollutionMap.js';
import AnnualPollutionMap from './Components/Layers/AnnualPollutionMap.js';
import FiltersInputDiseaseRisk from './Components/Filters/FilterInputDiseaseRisk.js';

const OverlayContext = createContext(null);

export const RisksContext = createContext(null);
 
export default function IndexMap() {
  
  const [dashboardActive, setDashboardActive] = useState(false);

  ///////////////// LAYER VARIABLES
  const [mapActive, setMapActive] = useState(true);
  
  // Holds the map layers of Deck.GL. 
  const [mapLayers, setMapLayers] = useState([]);

  // Town data for Other town map layers
  const [townLayerData, setLayerData] = useState(null);

  // Town Text Data for text layers
  const [townTextData, setTownTextData] = useState(null);

  // Toggled town layer
  const [townLayerToggled, toggleTownLayer] = useState(false);

  // Current town being hovered
  const [hoveredTown, setHovered] = useState(null);

  // Current town being hovered for legend display
  const [hoveredTownName, setHoveredTownName] = useState(null);
 

  ///////////////// ARGUMENT VARIABLES

  // Town Data for legend when hovered. 
  const [legendTown, setLegendTown] = useState(null);

  const [relativeRiskData, setRelativeRiskData] = useState({ 
    "COPD" : {  SO2: 0, NO2: 1.04, PM25: 1.14, PM10: 1.22, O3: 0},
    "LUNGC" : { SO2: 0, NO2: 1.07, PM25: 1.09, PM10: 1.10, O3: 0},
    "CVD" : { SO2: 0, NO2: 1.05, PM25: 1.14, PM10: 1.06, O3: 0},
    "RES" : { SO2: 0, NO2: 1.05, PM25: 1.14, PM10: 1.12, O3: 1.05},
    "IHD" : { SO2: 0, NO2: 1.05, PM25: 1.14, PM10: 1.06, O3: 0}
  });

  // Contains info of all pollutants we will monitor
  const [pollutants, setPollutants] = useState({
    "SO2" : { name: "SO2", flag : false},
    "PM25" : { name: "PM 2.5", flag : false},
    "PM10" : { name: "PM 10", flag : false},
    "NO2" :{ name: "NO2"},
    "O3" : { name: "O3", flag : false}
  })
  // Will be used by the pollutant map to retrieve date recording of data
  const [mainDate, setDate] = useState("2023-01-01");

  // Will be used by the pollutant map to trigger annual average recording of data
  const [polAnnum, setPolAnnum] = useState(false);

  // Overlay Arguments for town detail upon mouse click for town
  const [overlayArgs, setOverlayArgs] = useState(null);

  // Pollutant Filter reference
  const pollutantFilter = useRef(null);

  // Main Deck Component ref
  const deckRef = useRef();

  // Filter Box reference
  const filterBox = useRef(null);

  // Town Overlay reference
  const overlay = useRef();

  // Filter Options reference 
  const filterOptions = useRef();

  // Keeps track of selected filters
  const [selectedFilter, setFilter] = useState(null);

  // Map Access Token
  const MapAccessToken = 'pk.eyJ1Ijoib2hheW9yaW5vIiwiYSI6ImNtZXN1bjd4ODA4d2QyanM4aTBiNm9zN2gifQ.JAp21RU5bHyH5Y0xzdOZvQ';

  // Definining map to display first Malta
  const INITIAL_MAP_STATE = {
    latitude: 35.9375,
    longitude: 14.3754,
    zoom: 10,
    bearing: 0,
    pitch: 0,
  };

  //////// LOGIC FUNCTIONS
  
  // HOVERED TOWN USE EFFECT HANDLER
  useEffect(() => {
  const layers = [TownsLayer];


  if (hoveredTown) {
    layers.push(SelectedRegionLayer);
  }

  setMapLayers(layers);
}, [hoveredTown]);

// Use effect to retrieve town app data for town data layers once a pollutant has been selected
  useEffect(() => {
    // Retrieve selected pollutant key
    const selectedPol = Object.keys(pollutants).find(key => pollutants[key].flag == true);

    let data; 

    // "Annual Pollution per Town" Check
    if(selectedPol && polAnnum){
       const fetchData = async () => {
        data = await AnnualPollutionMap(selectedPol);
        setLayerData(data);
       }

       fetchData();

       return;
    } 

    // "Pollution per town" record check
    if (selectedPol){
      const fetchData = async () => {
        console.log(`Selected pollutant is ${selectedPol}, retrieving data...`)
        data = await PollutionMap(selectedPol, mainDate);
        setLayerData(data);
      }

      fetchData();

      console.log("Data retrieved for pollution map:", data);
     
    }
  }, [pollutants, mainDate, polAnnum])

  //////// EVENT LISTENERS 
 
  const clickEventOverlay = useCallback((e) => {
 
    
    if (overlayArgs != null){ 
 

      if (!(e.target == overlay.current) || !overlay.current.contains(e.target)){
 
        setOverlayArgs(null);
        setMapActive(true);
      }

    }
   }, [overlayArgs])

  // Event listener for filter box on click off click
  const clickEventFilter = useCallback((e) => {
      if (filterOptions.current == null){
        return;
      }
      
      // Check if click is inside filter box options (ignore)
      if(e.target == filterOptions.current || filterOptions.current.contains(e.target)){
        return;
      }

      if (selectedFilter != null) {
 
        if(filterBox.current && !filterBox.current.contains(e.target)){
 
          setFilter(null);

        }
      } 
    
  }, [selectedFilter] )

  // Event Listener Initializer
  useEffect(() => {

    document.addEventListener('click', clickEventFilter)
    // document.addEventListener('click', clickEventOverlay)

    return () => {
        document.removeEventListener('click', clickEventFilter);
        // document.removeEventListener('click', clickEventOverlay);
    }

  }, [clickEventFilter, clickEventOverlay])

  ///////// LAYER VARIABLES 

  // Text layers to display all Maltese district names
  const DistrictLayer = new TextLayer({
    id: 'TextLayer',
    data: tData,
    getPosition: d => d.coordinates,
    getText: d => d.name,
    getColor: [255, 255, 255],
    getSize: 16

  });

  // Used by other layers to display info overhead 
  const InfoTextLayer = new TextLayer({
    id: 'InfoTextLayer',
    data: tData|| [],
    getPosition: d => d.coordinates,
    getText: d => d.name,
    getColor: [255, 255, 255],
    getSize: 16
  });

  let SelectedRegionLayer = useMemo(() => new PolygonLayer({
    id: "SelectedPolygonLayer",
    data: hoveredTown,
    getPolygon: d => d,
    getLineColor: [255, 255 ,255],
    getFillColor: [179, 2, 64],
    getLineWidth: 10,
    lineWidthMinPixels: 1,
  }));

  // Polygon layer to overlay all Maltese town
  let TownsLayer = useMemo(() => new PolygonLayer({
    id: "PolygonTownLayer",
    data: mData,
    getPolygon : d => d.geometry.coordinates[0][0],
    getLineColor:[255, 255, 255],
    getLineWidth: 10,
    lineWidthMinPixels: 1,
    // ON CLICK EVENT LISTENER
    onClick: (info, event) => {
      if (info.object){
        // If overlay is open, check if click is within overlay bounds
        if (overlayArgs && overlay.current) {
          // Get overlay coordinates
          const rect = overlay.current.getBoundingClientRect();
          // Get click coordinates
          const clickX = info.x;
          const clickY = info.y;
          
          // If click is inside overlay, ignore polygon click
          if (clickX >= rect.left && clickX <= rect.right && 
              clickY >= rect.top && clickY <= rect.bottom) {
            return;
          }
        }
        // Set town overlay args with name, and viewport coordinates
        setOverlayArgs({townName: info.object.properties.plain_name, xPos: Math.floor(info.x), yPos: Math.floor(info.y)});
        setMapActive(false);
      }
    },
    // ON HOVER EVENT LISTENER
    onHover: (info, event) => {
      // If object info exists
      if (info.object && !overlayArgs){
        // Highlight town
        setHovered(info.object.geometry.coordinates[0])
        // console.log("Hovered town:", info.object.properties.plain_name);
        setHoveredTownName(info.object.properties.plain_name);
      }else{
        return; 
      } 
    },
    pickable: true
  }));

  // Polygon layer for pollutant exposure levels per town
  let PollutionLevelLayer = useMemo(() => new PolygonLayer({  
    id: "PolygonLevelLayer",
    data: townLayerData !== null ? townLayerData : null ,
    getPolygon : d => {
      if (d.geometry == null) { return [] } else { return d.geometry[0][0]}},
    getLineColor:[255, 255, 255],
    getFillColor: d => PollutionLevelColorGrade(d.pol, WHOThresholds[Object.keys(pollutants).find(key => pollutants[key].flag == true)]),
    getLineWidth: 10,
    lineWidthMinPixels: 1,
    pickable: false,
    
  }), [townLayerData, pollutants]); 

  let hoverLayer = useMemo(() => {

      if (hoveredTown) {
      SelectedRegionLayer = SelectedRegionLayer.clone({
        data: hoveredTown
      });
      return SelectedRegionLayer;
    }

  },[hoveredTown])

  // Create Polygon Levels for Pollution level grading
  let layers = useMemo(() => {

    let baseLayers = [];

    if (TownsLayer){
      baseLayers.push(TownsLayer);
    }

    if (townLayerToggled){

      // Retain column layers if they exist
      if (townLayerData && townLayerData.length > 0) {
        PollutionLevelLayer = PollutionLevelLayer.clone({
          data: Object.values(townLayerData)
        });
        baseLayers.push(PollutionLevelLayer);
      }
    }

    return baseLayers;

  }, [TownsLayer, townLayerData, pollutants, townLayerToggled])

   ///////// RENDERING

   const renderPollutantFilter = () => {
    return ( 
    <>
      <h2>Pollution Level Grading</h2>
      <hr></hr>
      <FilterSelection data={pollutants} setData={setPollutants} />
      <div className={"filters-options-main"}>
        <h3>Date Selection:</h3>
        <input disabled={polAnnum} type="date" id="date" defaultValue={mainDate} onChange={(e) => {setDate(e.target.value)}}></input>
        <label for={"annum"}> Annual Average:</label>
        <input type="checkbox" id="annum" name="annum" checked={polAnnum} onChange={(e) => setPolAnnum(e.target.checked)}></input>
        
        <label for={"pollution"}>Toggle Filter Mapping:</label>
        <input placeholder={"Pollution Layer"} checked={townLayerToggled} type="checkbox" id="pollution" name="pollution" onChange={() => toggleTownLayer(!townLayerToggled)}/> 
      </div>
    </>
    )
   }

   const renderSettingsFilter = () => {
    return (
      <>
        <h2>Disease Settings</h2>
        <hr></hr>
        <h4>Disease Mortality Relative Risks</h4>
        <p>The Following are the relative risks of disease mortality based on each pollutants.</p>
        <p>The relative risks are expressed in the form of X per 10µg/m³</p>
        <FiltersInputDiseaseRisk data={relativeRiskData} setData={setRelativeRiskData}/>
       <span className={'warning-box'}> <p>Note: The relative risks used by default are based on the WHO Hrapie-2 Project. It should be known that the accuracy
          of these relative risks is not guranteed as they are based on studies with different environmental conditions than those in Malta.
          If possible, these RRs should be ammended to be more representative of the Maltese population and atmosphere for best accurate results.
        </p> </span>
      </>
    )
   }
 

  return (
    <>
    <DeckGL controller={mapActive} ref={deckRef} initialViewState={INITIAL_MAP_STATE}layers={[layers, hoverLayer]}>
      <div ref={filterOptions} className={"map-controls-div"}>
        <div className="map-controls">
          <h2 className="filter-title">Controls</h2>
          <button onClick={() => setFilter('pollutantFilter')} className={selectedFilter == 'pollutantFilter' ? "map-control-btn active" : "map-control-btn"}>Pollutants</button>
          <button onClick={() => setFilter('relativeRiskFilter')} className={selectedFilter == 'relativeRiskFilter' ? "map-control-btn active" : "map-control-btn"}>Disease Settings</button>
          <button className="map-control-btn" onClick={ () => setDashboardActive(!dashboardActive)}>Dashboard</button>
        </div>
        <div ref={filterBox} className={selectedFilter ? "filters-content active" : "filters-content"}>
          {selectedFilter == 'pollutantFilter' ? renderPollutantFilter() : null}
          {selectedFilter == 'relativeRiskFilter' ? renderSettingsFilter() : null}
        </div>
      </div>

      <Suspense fallback={<p>Loading...</p>}>
         {overlayArgs != null ? <TownOverview riskRatios={relativeRiskData} overlayRef={overlay} args={overlayArgs} setArgs={setOverlayArgs} setMapActive={setMapActive}/> : null}
      </Suspense>
      <Map
        id="MainMap"
        mapStyle="mapbox://styles/ohayorino/cmet1zrt8002r01sc8rfq2fw2"
        mapboxAccessToken={MapAccessToken}
      />
 
    </DeckGL>
    <RisksContext.Provider value={{relativeRiskData}}>
       {dashboardActive ? <StatisticsDashboard /> : null}
    </RisksContext.Provider>
   
    {townLayerToggled && <Legend title={"Pollution Level Legend"} lim={WHOThresholds[Object.keys(pollutants).find(key => pollutants[key].flag == true)]} pol={Object.keys(pollutants).find(key => pollutants[key].flag == true)}/>}
    {hoveredTown && <div className='hover-info-box'>
      <h4>Currently Hovering Over: {hoveredTownName}</h4>
    </div>}
    </>
  );
}
