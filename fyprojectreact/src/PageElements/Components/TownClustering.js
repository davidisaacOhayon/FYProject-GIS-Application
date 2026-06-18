import axios from 'axios';
import Box from '@mui/material/Box';
import { BarChart, LineChart, ScatterChart } from '@mui/x-charts';
import {useEffect, useState} from 'react';
import { listofPollutants } from './Backend/PollutionInfo';
import '../Stylesheets/townclustering.css';

export default function TownClustering({polTown}){


    // 0 - High Exposure
    // 1 - Medium Exposure
    // 2 - Low Exposure
    const [page, setPage] = useState(0);
 
    const [pol, setPol] = useState("NO2");

    const [data, setData] = useState(null);


    const [monthData, setMonthData] = useState({
        "Jan": 0,
        "Feb": 0,
        "Mar": 0,
        "Apr": 0,
        "May": 0,
        "Jun": 0,
        "Jul": 0,
        "Aug": 0,
        "Sep": 0,
        "Oct": 0,
        "Nov": 0,
        "Dec": 0
        
    });

    // EDA Data
    const [edaData, setEdaData] = useState(null);

    const resetMonthData = () => {
        setMonthData({
        "Jan": 0,
        "Feb": 0,
        "Mar": 0,
        "Apr": 0,
        "May": 0,
        "Jun": 0,
        "Jul": 0,
        "Aug": 0,
        "Sep": 0,
        "Oct": 0,
        "Nov": 0,
        "Dec": 0 
    });
    }

    useEffect(() => {
        
        resetMonthData(); 
        
        axios.post("/getTownExpPolCluster/", {town: polTown, pollutant: pol})
        .then(res => { 
            console.log(`cluster data ${JSON.stringify(res.data)}`)
            setData(res.data);
        })
        .catch(err => console.log(err));

        axios.get(`/getEDATownPol/?town=${polTown}&pollutant=${pol}`)
        .then(res => {
            setEdaData(res.data);
        })
        .catch(err => console.log(err));

    },[polTown, pol]);


    const exp = ["Low Exposure", "Medium Exposure", "High Exposure"];

    const expColors = ["#4255FB", "#FFB423", "#FA4F58"];
 
    const renderPage = () => {
        return (
            <>
            <h3>{exp[page]} covers {data[page]["coverage"]}% of 365 days.</h3>
            <Box>
                <BarChart
                    xAxis={[{ scaleType: "band", data : Object.keys(monthData)}]}
                    series={[{color: expColors[page],name: "Days" , label: "Days Of Occurance", data : Object.values(data[page]["data"]), valueFormatter : (val) => `${val} days of ${exp[page]}`}]}
                    height={300}

                    sx={{
                        '.MuiChartsAxis-line': { stroke: '#fff !important' },       // axis lines white
                        '.MuiChartsAxis-tick': { stroke: '#fff !important' },       // tick marks white
                        '.MuiChartsAxis-tickLabel': { fill: '#fff !important' },    // tick text white
                        '.MuiChartsLegend-root': { color: '#fff !important' },      // legend white
                        '.MuiChartsTooltip-root': { color: '#fff !important' },     // tooltip text black
                        '.MuiChartsTooltip-paper': { background: '#fff !important' } // tooltip background white
                }}/>

                <ScatterChart
                height={300}
                series={
                    Object.entries(data).map(([key, value]) => ({
                        label: exp[key],
                        data: Object.entries(value.data).map(([x, y]) => ({
                            x: x,
                            y: Number(y),
                            labelX: `${x}`,
                            labelY: `${y} days of ${exp[key]}`,
                            valueFormatter: (val) => `${val} days of ${exp[key]}`
                        
                        })),
                        // valueFormatter: (val) => `${val} days of occurance`

                    }))
                }
                xAxis={[{ scaleType: "band", data : Object.keys(monthData)}]}
                                    sx={{
                        '.MuiChartsAxis-line': { stroke: '#fff !important' },       // axis lines white
                        '.MuiChartsAxis-tick': { stroke: '#b26a6a !important' },       // tick marks white
                        '.MuiChartsAxis-tickLabel': { fill: '#fff !important' },    // tick text white
                        '.MuiChartsLegend-root': { color: '#fff !important' },      // legend white
                        '.MuiChartsTooltip-root': { color: '#fff !important' },     // tooltip text black
                        '.MuiChartsTooltip-paper': { background: '#fff !important' } // tooltip background white
                }}
                />


            </Box>
            </>
        )
    }
 
 

    if (data){
        return(
            
            <div className={"pollution-cluster-div"}>
            <h2>Statistics for {pol}</h2>
            <hr></hr>
            <br></br>
            <h3> {pol} - {exp[page]} in {polTown} | Range between {data[page]["min"]}µg/m³ and {data[page]["max"]}µg/m³.</h3>
            <p> Displays Number of days concentrations were recorded at various exposure levels.</p>
            <br></br>
            <button className={"btn"} onClick={() => setPage(2)}>HighExp</button>
            <button className={"btn"} onClick={() => setPage(1)}>Mid Exp</button>
            <button className={"btn"} onClick={() => setPage(0)}>Low Exp</button>
            <ol>
                {listofPollutants.map(poll => {
                    return <button className={pol == poll? "btn active" : "btn"} onClick={() => setPol(poll)}>{poll}</button>
                })}
            </ol>
            {data && renderPage() }
            <h2>Details</h2>
            <hr></hr>

            {edaData &&
            <div className={"eda-data-container"}>
                <div className={"eda-data-div"}>
                    <h3>Standard Deviation:</h3>
                    <p>{edaData['STD_Dev']}µg/m³</p>
                </div>

                <div className={"eda-data-div"}>
                    <h3>Mean:</h3>
                    <p>{edaData['Mean']}µg/m³</p>
                </div>
                <div className={"eda-data-div"}>
                    <h3>Range:</h3>
                    <p>{edaData['Min']} - {edaData['Max']} µg/m³</p>
                </div>
                <div className={"eda-data-div"}>
                    <h3>Interquartile Range:</h3>
                    <p>{edaData['IQR']}µg/m³</p>
                <p style={{fontSize: "1rem"}}>Q1: {edaData["Q1"]}µg/m³ </p> 
                <p style={{fontSize: "1rem"}}> Q3: {edaData["Q3"]}µg/m³</p>
                
                </div>
            </div>

                

            }

            </div>
        )
    }else {
        return <h2>No Data Available At the moment.</h2>
    }




}