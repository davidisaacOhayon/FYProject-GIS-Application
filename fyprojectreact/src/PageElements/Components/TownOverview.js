// When a user hovers over a town, we will retrieve the latest pollutant reading
// to then display it on an overlay box on the town, inplace of the cursor.

import { useCallback, useEffect, useMemo, useState, useRef, useContext, Suspense } from "react";
import axios from "axios";
import { getTownPollution} from "./Backend/Database_connections";
import { pollutantDBKeyMap, polAcronymNameMap, pollutantColors, WHOThresholds, IHD_RR, COPD_RR, LUNGC_RR, globalRR_CVD, globalRR_RES} from "./Backend/PollutionInfo";
import TownClustering from "./TownClustering";
import RES from  "../Logos/RES.svg";
import CVD from "../Logos/CVD.svg";
import '../Stylesheets/townoverview.css';
import Button from "@mui/material/Button";
import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import { ChartsText, LineChart } from '@mui/x-charts';
import { display } from "@mui/system";
import ProgressBar from "./ProgressBar/ProgressBar";
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import katex from 'katex';
import RiskBar from "./DashboardComponents/RiskBar";

 

export default function TownOverview({riskRatios, args, overlayRef, setArgs, setMapActive}){

    // Contains retrieved data from requests
    const [pollutantReadings, setPollutants] = useState(null);
    
    // Contains the range for the xAxis dates
    const [monthRange, setMonthRange] = useState([0, 11]);

    // Contains applied pollutants for filtering
    const [pollutantFilter, setPollutantFilter] = useState(["SO2"]);

    // Contains applied display options of overview
    const [displayOption, setDisplayOption] = useState('pollution');
    
    // List down each pollutant key
    const pollutants = ['SO2', 'NO2', 'PM25','PM10', 'O3'];

    // Display Data for graph visuals (Y-Axis)
    const [displayData, setDisplayData] = useState(null);

    // Retains all data records of current year collected
    const [dateData, setDateData] = useState(null);

    // Retains calculated risks 
    const [riskData, setRiskData] = useState(null);

    // Pollutant averages
    const [polAverages, setPolAverages] = useState(null);


    let newX = 0, newY = 0;

    const startX = useRef(0);
    const startY = useRef(0);
    const overlayX = useRef(0);
    const overlayY = useRef(0);

 

    const computeAdverseLevel = (pol, avg) => {
        const threshold = WHOThresholds[pol] / 3;

        if(avg <= threshold){
            return <span style={{color: "#51d23e"}}>Minimal Risk</span>;
        } else if (avg <= threshold * 2){
            return <span style={{color: "#f78d41"}}>Moderate Risk</span>;
        }else if (avg > threshold * 3){
            return <span style={{color: "#e72a39"}}>At Risk</span>;
        }

    }

    const marks = [
        { value: 0, label: "Jan" },
        { value: 1, label: "Feb" },
        { value: 2, label: "Mar" },
        { value: 3, label: "Apr" },
        { value: 4, label: "May" },
        { value: 5, label: "Jun" },
        { value: 6, label: "Jul" },
        { value: 7, label: "Aug" },
        { value: 8, label: "Sep" },
        { value: 9, label: "Oct" },
        { value: 10, label: "Nov" },
        { value: 11, label: "Dec" },
    ];


    useEffect(() => {
        if( args.townName == null){
            return
        }
        // Retrieve pollutant info on town
        axios.get(`/getPollutantVolTown/?town=${args.townName}`)
        .then(res => {
            if (res.data) {
                setPollutants(res.data) 
                processPollutantData()
            }else {
                return;
            }
        }) 
        .catch(err => {
            return;
        })
    }, [])
    
    // Process pollutant data for risk analysis on potential diseases
    useEffect(() => {
        if( args.townName == null){
            return
        }
        // Retrieve pollutant info on town
        axios.get(`/getPollutantVolTown/?town=${args.townName}`)
        .then(res => {
            if (res.data.length !== 0 && res != null) {
                setPollutants(res.data) 
                processPollutantData()
            } else {
                setRiskData(null);
                return;
            }
        }) 
        .catch(err => {
            return;
        })

        // Retrieve risks calculated by pollutant readings
        axios.post(`/getDiseaseRisks/`, {"town": args.townName, "risks": riskRatios})
        .then(res => {
            if (res.data.length !== 0 && res != null) {
                setRiskData(res.data);
            } else {
                setRiskData(null);
            }
        })
        .catch(err => {
            return;
        })


        // Retrieve Pollutant averages
        axios.get(`/getPollutantAvgsTown?town=${args.townName}`)
        .then(
            res => {
                if(res.data.length !== 0 && res != null) {
                    setPolAverages(res.data);
                } else {
                    setRiskData(null);
                }
            }
        )
        .catch(err => {
            return;
        })

        
        

    },[args, pollutantFilter, monthRange])

    const applyPollutant = (pol) => {
        if (!checkActivePollutant(pol)) {
            setPollutantFilter(prev => [...prev, pol])
        }else{
            setPollutantFilter(prev => [...prev.filter(x => pol !== x)])
        }
    }

    const checkActivePollutant = (pol) =>{
        return pollutantFilter.includes(pol);
    }

    const processPollutantData = () => {
        if (!pollutantReadings){
            return;
        }
        // Contain Pollutant Data
        let dataset = []
        // Contain Dates data 
        let datedataset = []

        let polReading;

        // Filter data by month range 
        if(monthRange) {

            polReading = pollutantReadings.filter(set => {
                const date = new Date(set['day']);
                // console.log(`${date.getMonth()} compared to ${yearRange}`)
                return monthRange[0] <= date.getMonth() && date.getMonth() <= monthRange[1];
            })

        }
        
        polReading.map( (set, index) => {
            // tempSet of 'row'
            let tempSet = {}
            // Retain Date of row
            tempSet["date"] = set['day']
            // Get each pollutant reading of current row
            pollutantFilter.map( (pol ,indx) => {
                
                tempSet[pol] = set[pollutantDBKeyMap[pol]];
                
            })
            // push onto list of dataset
            dataset.push(tempSet);
        })
        
        // Push current row date onto date dataset list
        dataset.map(d => {
            datedataset.push(new Date(d.date));
        })

        setDateData(datedataset);

        let tempDataSet = []

        // Apply display filter 
        pollutantFilter.map((pol) => {
            let tempSet = {}
            tempSet['label'] = pol;
            tempSet['data'] = dataset.map(d => d[pol] ?? null);
            tempSet['color'] = pollutantColors[pol];

            tempDataSet.push(tempSet);
        });
        setDisplayData(tempDataSet);



    }

    const mouseDown = (e) => {
        if(e.target !== overlayRef.current){
            return;
        }

        e.stopPropagation();
        startX.current = e.clientX;
        startY.current= e.clientY;


        overlayX.current = overlayRef.current.getBoundingClientRect().left;
        overlayY.current = overlayRef.current.getBoundingClientRect().top;

        document.addEventListener("mousemove", mouseMove);
        document.addEventListener("mouseup", mouseUp)
    }

    const mouseMove = useCallback((e) => {
        e.stopPropagation();
        const el = overlayRef.current;

        const newX = e.clientX;
        const newY = e.clientY;
        

        el.style.left = overlayX.current + (newX - startX.current) + 'px';
        el.style.top =  overlayY.current + (newY - startY.current) + 'px';


    }, [overlayRef])
    
    const mouseUp = (e) => {
        document.removeEventListener('mousemove', mouseMove)
    }

    useEffect(() => {
        const el = overlayRef.current;
        if(!el) {return}

        el.addEventListener('mousedown', mouseDown)

        return () => 
            {
                el.removeEventListener('mousedown', mouseDown)
                document.removeEventListener('mousemove', mouseMove)
                document.removeEventListener('mouseup', mouseUp)
                startX.current = 0;
                startY.current = 0;
                overlayX.current = 0;
                overlayY.current = 0;
                newX = 0;
                newY = 0;
                
            }
    }, [])

    const computeRelativeRisk = (pol, type) => {

        let rawdata = riskData[type];

        // Filter out 0 values which indicate no risk calculated for pollutant
        var data = Object.fromEntries(Object.entries(rawdata).filter(([key, value]) => value !== 0));
        
        return <RiskBar title={pol} perc={data[pol]}/>

    }


    const formatRisk = (input) => {
       return <h4>{input > 1 ? `+ ${(input * 100).toFixed(2) - 100}% ` : "N/A" }</h4>
    }
        
    const diseaseOverview = () => {

        if (riskData == null) {
            return (<>
                <h1 style={{marginTop: "5vh"}}>
                    No Data Available for analysis.
                </h1>
            </>)
        }

        return(
                <div className={"disease-overview"}> 
                    <h2>Disease Mortality Overview</h2>
                    <hr></hr>
                    <span className={'warning-box'}>Note: Percentages denote the town population's increased long-term mortality risk relative to the WHO exposure limits.
                        The Relative Risks have been calculated using CRFs provided by the <a href={"https://www.who.int/publications/i/item/9789289062633"}>HRAPIE-2 Project</a> WHO.  
                        It should be noted that these risks are highly suggestive and may not be sufficiently accurate.
                        <br></br>
                        <br></br>
                         If available, you can change the relative risks in the settings bar. 
                    </span>
                    <br></br>

                    <h3>Risk Based on Annual Average</h3>
                    <hr></hr>
                    <div className={"disease-overview-container"}>
                        <div className={"disease-overview-box"}>
                            <h3>Respiratory Disease Mortality</h3>
                            <img className={"disease-logo"} src={RES}></img>

                            <div className={"disease-overview-value"}>{
                                Object.keys(riskData["RES"]).map(pol => {
                                    return <div key={pol}>
                                        {computeRelativeRisk(pol, "RES")}
                                        </div>
                                })
                            }</div>
                        </div>
                        <div className={"disease-overview-box"}>
                            <h3>Cardiovascular Disease Mortality</h3>
                            <img className={"disease-logo"} src={CVD}></img>
               
                            <div className={"disease-overview-value"}>{
                                    Object.keys(riskData["CVD"]).map(pol => {
                                        return <div key={pol}>
                                            {computeRelativeRisk(pol, "CVD") }
                                            </div>
                            })}</div>
 
                        </div>
                    </div>
                    <div className={"disease-table"}>
                        <h3>Specific Disease Mortalities</h3>
                        <br></br>
                        <table>
                            <thead>
                                <tr>
                                    <th>Disease</th>
                                    <th>NO2</th>
                                    <th>PM10</th>
                                    <th>PM25</th>
                                    <th>O3</th>
                                    <th>SO2</th>
                                </tr>
                            </thead>
                            { riskData &&

                            <tbody>
                                <tr>
                                    <td>Lung Cancer</td>
                                    <td>{riskData ?  formatRisk(riskData["LUNGC"]["NO2"]) : "Loading"}</td>
                                    <td>{riskData ? formatRisk(riskData["LUNGC"]["PM10"]) : "Loading"}</td>
                                    <td>{riskData ? formatRisk(riskData["LUNGC"]["PM25"]) : "Loading"}</td>
                                    <td>{riskData ? formatRisk(riskData["LUNGC"]["O3"]) : "Loading"}</td>
                                    <td>{riskData ? formatRisk(riskData["LUNGC"]["SO2"]) : "Loading"}</td>
                                </tr>
                                <tr>
                                    <td>IHD</td>
                                    <td>{riskData ? formatRisk(riskData["IHD"]["NO2"]) : "Loading"}</td>
                                    <td>{riskData ? formatRisk(riskData["IHD"]["PM10"]) : "Loading"}</td>
                                    <td>{riskData ? formatRisk(riskData["IHD"]["PM25"]) : "Loading"}</td>
                                    <td>{riskData ? formatRisk(riskData["IHD"]["O3"]) : "Loading"}</td>
                                    <td>{riskData ? formatRisk(riskData["IHD"]["SO2"]) : "Loading"}</td>
                                </tr>
                                <tr>
                                    <td>COPD</td>
                                    <td>{riskData ? formatRisk(riskData["COPD"]["NO2"]) : "Loading"}</td>
                                    <td>{riskData ? formatRisk(riskData["COPD"]["PM10"]) : "Loading"}</td>
                                    <td>{riskData ? formatRisk(riskData["COPD"]["PM25"]) : "Loading"}</td>
                                    <td>{riskData ? formatRisk(riskData["IHD"]["O3"]) : "Loading"}</td>
                                    <td>{riskData ? formatRisk(riskData["COPD"]["SO2"]) : "Loading"}</td>
                                </tr>
                            </tbody>

                            }
                        </table>

                    </div>

                    <div className={"disease-overview-explanation"}>
                            <h2>How relative risks are calculated.</h2>
                            <p>The above estimations of relative risk increase are calculated using WHO Thresholds as our baseline concentration. Therefore, these relative risks are made relative to the 
                                WHO Guidelines of each pollutant threshold, using known Relative Risks provided by the WHO Hrapie-2 Study.
                                <br></br>
                                <br></br>
                                Note: If the annual reading does not exceed the guideline, there will be no relative increase in risk.
                            </p>

                            <table className={"guideline-table"}>
                                <thead>
                                    <tr>
                                        <th>Pollutant</th>
                                        <th>WHO Guideline. 2022</th>
                                        <th>{args.townName} Reading</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>PM 2.5</td>
                                        <td>{WHOThresholds["PM25"]} µg/m³</td>
                                        <td>{polAverages["PM25"]} µg/m³</td>
                                    </tr>
                                    <tr>
                                        <td>PM 10</td>
                                        <td>{WHOThresholds["PM10"]} µg/m³</td>
                                        <td>{polAverages["PM10"]} µg/m³</td>
                                    </tr>
                                        <tr>
                                        <td>O3</td>
                                        <td>{WHOThresholds["O3"]} µg/m³</td>
                                        <td>{polAverages["O3"]} µg/m³</td>
                                    </tr>
                                    <tr>
                                        <td>NO2</td>
                                        <td>{WHOThresholds["NO2"]} µg/m³</td>
                                        <td>{polAverages["NO2"]} µg/m³</td>
                                    </tr>
                                    <tr>
                                        <td>SO2</td>
                                        <td>{WHOThresholds["SO2"]} µg/m³</td>
                                        <td>{polAverages["SO2"]} µg/m³</td>
                                    </tr>
                                </tbody>
                            </table>

                            <p>The following table contains all the Relative Risks provided by the HRAPIE-2 study.</p>

                            <table className={"guideline-table"}>
                                
                                <thead>
                                    <tr>
                                        <th>Disease</th>
                                        <th>PM2.5</th>
                                        <th>PM10</th>
                                        <th>O3</th>
                                        <th>NO2</th>
                                    </tr>
                                </thead>
                                <tbody>
                                <tr>
                                    <td>Respiratory Related</td>
                                    <td>{globalRR_RES["PM25"]} per 10 µg/m³</td>
                                    <td>{globalRR_RES["PM10"]} per 10 µg/m³</td>
                                    <td>{globalRR_RES["O3"]} per 10 µg/m³</td>
                                    <td>{globalRR_RES["NO2"]} per 10 µg/m³</td>
                                </tr>
                                <tr>
                                    <td>Cardiovascular Related </td>
                                    <td>{globalRR_CVD["PM25"]} per 10 µg/m³</td>
                                    <td>{globalRR_CVD["PM10"]} per 10 µg/m³</td>
                                    <td>N/A</td>
                                    <td>{globalRR_CVD["NO2"]} per 10 µg/m³</td>
                                </tr>
                                <tr>
                                    <td>IHD</td>
                                    <td>{IHD_RR["PM25"]} per 10 µg/m³</td>
                                    <td>{IHD_RR["PM10"]} per 10 µg/m³</td>
                                    <td>N/A</td>
                                    <td>{IHD_RR["NO2"]} per 10 µg/m³</td>
                                </tr>
                                <tr>
                                    <td>COPD</td>
                                    <td>{COPD_RR["PM25"]} per 10 µg/m³</td>
                                    <td>{COPD_RR["PM10"]} per 10 µg/m³</td>
                                    <td>N/A</td>
                                    <td>{COPD_RR["NO2"]} per 10 µg/m³</td>
                                </tr>
                                <tr>
                                    <td>Lung Cancer</td>
                                    <td>{LUNGC_RR["PM25"]} per 10 µg/m³</td>
                                    <td>{LUNGC_RR["PM10"]} per 10 µg/m³</td>
                                    <td>N/A</td>
                                    <td>{LUNGC_RR["NO2"]} per 10 µg/m³</td>
                                </tr>
                                </tbody>
                            </table>
                            <p> 
                                The Relative Risks extracted here are then used in the exponential relative risk model to calculate each individual relative risk given by 
                                pollutant concentrations, relative to their corresponding WHO Guideline for long-term mortality of the complication.
                            </p>

                  
                    </div>
                    
                </div>
                
        )
    }

    const pollutionOverview = () => {
    
        if (!pollutantReadings || !displayData) {
            return (<>
                <h1 style={{marginTop: "5vh"}}>
                    No Data Available for analysis.
                </h1>
            </>)

        }

        return( 
            <>
            <div className={'town-overview-details'}>

                <Box>
                    {/* µg/m³ */}
                    <LineChart
                    xAxis={[
                        {
                        data: dateData !== null ? dateData : [],
                        scaleType: 'time',      
                        zoom: true,
                        name: "Day",
                        showMark: false,
                        valueFormatter: (date) => {
                            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
                            return `${monthNames[date.getMonth()]} ${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;

                        }
                        }
                    ]}
                    
                    series={[
                        ...displayData !== null ? displayData.map( d => ({
                            ...d,
                            valueFormatter: (value) => `${Math.round(value * 100) / 100} µg/m³`}
                        )) : []]
                    }
                        
                    height={300}
                    
                    sx={{
                        '.MuiChartsAxis-line': { stroke: '#fff !important' },       // axis lines white
                        '.MuiChartsAxis-tick': { stroke: '#fff !important' },       // tick marks white
                        '.MuiChartsAxis-tickLabel': { fill: '#fff !important' },    // tick text white
                        '.MuiChartsLegend-root': { color: '#fff !important' },      // legend white
                        '.MuiChartsTooltip-root': { color: '#fff !important' },     // tooltip text black
                        '.MuiChartsTooltip-paper': { background: '#fff !important' }, // tooltip background white
                        '.MuiChartsTooltip-mark': {display: "none"}
                    }}
                    >
                    

                    {pollutantFilter.map(pol => {
                        return ( 
                        
                        <ChartsReferenceLine
                          key={pol}
                          y={WHOThresholds[pol]}        
                          label={`WHO Yearly (${WHOThresholds[pol]})`}
                          labelAlign="end"
                          labelStyle={{fill: "white", fontSize: 12, fontWeight: 'bold'}}
                         lineStyle={{ stroke: pollutantColors[pol], strokeWidth: 2, strokeDasharray: '5 5' }} // optional dashed style
                        />
                        
                        )
                    })}
                    
 
                    </LineChart>
                </Box>

                <div className={'year-range-filter'}>
                    <Slider
                        min={0}
                        max={11}
                        step={1}
                        value={monthRange}
                        onChange={(e, v) => setMonthRange(v)}
                        className="year-range-input"
                        marks={marks}
                        sx={{
                            "& .MuiSlider-mark": {
                            backgroundColor: "white",
                            height: 8,
                            width: 2,
                            },
                            "& .MuiSlider-markLabel": {
                            color: "white",
                            fontSize: "0.75rem",
                            },
                        }}
                    />
                </div>


                <Suspense fallback={<h2>Loading</h2>}>
                    <TownClustering  polTown={args.townName}/>
                </Suspense>

                
                </div>
                <div className={"pollution-yearly-avg"}>
                    <h2>Yearly Average Pollutant Levels</h2>
                    <hr></hr>
                    <br></br>
                    <Box className={"pollution-yearly-avg-box"}>
                        {pollutants.map(pol => {        
                            const mean = pollutantReadings ? pollutantReadings.reduce((acc, curr) => acc + curr[pollutantDBKeyMap[pol]], 0) / pollutantReadings.length : 0;
                            return <ProgressBar title={`${pol}`} value={mean} threshold={WHOThresholds[pol]} color={pollutantColors[pol]} key={pol} advLevel={computeAdverseLevel(pol, mean)}/>
                         })
                        }
                    </Box>
                </div>
            </>
        )
    }

    const handleRender = () => {
        if(displayOption === 'pollution'){
            return pollutionOverview();
        } 
        if (displayOption === 'disease'){
            return diseaseOverview();
        }
    }


    return(
        <>
            <div 
                ref={overlayRef} 
                className={'town-overview'} 
                style={{position: 'absolute', top: args.yPos, left: args.xPos}}>
                <h1 >{args.townName}</h1>
                <button className={"close-btn-overview"} onClick={() => {setArgs(null); setMapActive(true)}}>Close</button>
                <ul className={'display-options'}>
                    <li>
                        <Button onClick={() => setDisplayOption('pollution')} className={displayOption === 'pollution' ? 'disp-opt active' : 'disp-opt'}>Pollution Overview</Button>
                    </li>
                    <li>
                        <Button onClick={() => setDisplayOption('disease')} className={displayOption === 'disease' ? 'disp-opt active' : 'disp-opt'}>Disease Overview</Button>
                    </li>   
                </ul>
                <hr/>

                
                <ul className={'pollutant-filters'}>
                    {pollutants.map((e, index) => 
                        <li key={index} style={ checkActivePollutant(e) ? {backgroundColor : pollutantColors[e]} : {backgroundColor : "#1f1f1f"}} className={checkActivePollutant(e) ? 'pol-btn active' : 'pol-btn'}>
                         <Button onClick={() => applyPollutant(e)}>{e}</Button>
                        </li>
                    )}

                </ul>

                {handleRender()}

 


            </div>
        </>
    )



}