
import Box from '@mui/material/Box';
import { LineChart } from '@mui/x-charts';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import { pollutantColors, WHOThresholds } from '../Backend/PollutionInfo';
import {useEffect} from 'react';
export default function TownOverviewDashboard({town, data, dateData}){

 

    return(
        <div className={"town-item"}>
            <h2>{town}</h2>
            <hr/>
            <Box>
                <LineChart
                    xAxis={[
                        {
                        data: dateData !== null ? dateData : [],
                        scaleType: 'time',      
                        zoom: true,
                        valueFormatter: (date) => {
                            const month = date.getMonth();
                            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            return `${monthNames[month]} ${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear().toString()}`;
                        }
                        }
                    ]}
                    series={[
                        ...data !== null ? data.map( d => ({
                            ...d,
                        valueFormatter: (value) => `${value} µg/m³`
                        }
                        )) : []
                    ]}
                    height={300}
                    sx={{
                        '.MuiChartsAxis-line': { stroke: '#fff !important' },       // axis lines white
                        '.MuiChartsAxis-tick': { stroke: '#fff !important' },       // tick marks white
                        '.MuiChartsAxis-tickLabel': { fill: '#fff !important' },    // tick text white
                        '.MuiChartsLegend-root': { color: '#fff !important' },      // legend white
                        '.MuiChartsTooltip-root': { color: '#fff !important' },     // tooltip text black
                        '.MuiChartsTooltip-paper': { background: '#fff !important' }, // tooltip background white
                        '& text': {
                            fill: 'white',
                            fontWeight: '900',
                            fontSize: '25px'
                        }
                    }}


                  

                    
                                        
                    />
                                                                

                    
                </Box>
        </div>
    )

}